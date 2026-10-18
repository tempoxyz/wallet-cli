import { Errors } from "incur";
import { FundingRecoveryError, MachineFetchError, planPayment } from "machine-fetch";
import { extension, mppxRequirement } from "machine-fetch/adapters/mppx";
import type {
  AssetAmount,
  Funder,
  PaymentPlan,
  PaymentPolicy,
  PaymentRequirement,
} from "machine-fetch/interfaces";
import type { Challenge } from "mppx";
import { parseUnits } from "viem";

import { CtaError } from "../cli/incur-compat.js";
import { commandError, paymentError, walletError } from "../shared/errors.js";
import { tempoUsdTokens } from "../shared/chains.js";
import type { Network } from "../shared/network.js";
import { continuationCommand } from "../shared/next.js";
import { escapeInvisible, sanitizeText } from "../shared/utils.js";

/**
 * Payment funding through machine-fetch: every charge credential is created only after
 * `planPayment` has checked it against policy, and only with the context its funder prepared.
 */

/** What a payment may spend, from `--max-spend`. */
export type SpendLimits = {
  /** The payment network; its Tempo USD tokens are capped. */
  network: Network;
  /** The cap in token units (six decimals), from `spendCap`. */
  maxSpend: string;
};

/**
 * The policy for one charge (D5). `maxPayment` lists every USD token the CLI trusts on the network
 * at `maxSpend`, so a payment in any other token is refused rather than guessed at with six
 * decimals. A zero-amount proof moves nothing, and a subscription is bounded by the per-period
 * limit the wallet signs, so neither has a cap.
 */
export function chargePolicy(
  challenge: Pick<Challenge.Challenge, "intent" | "request">,
  limits: SpendLimits,
): PaymentPolicy {
  if (challenge.intent === "subscription" || challenge.request.amount === "0") return {};
  return { maxPayment: maxPaymentAssets(limits) };
}

/** `maxSpend` of each USD token the CLI trusts on `limits.network`, as machine-fetch asset limits. */
export function maxPaymentAssets(limits: SpendLimits): AssetAmount[] {
  const amount = parseUnits(limits.maxSpend, 6);
  const network = caip2(limits.network.chainId);
  return tempoUsdTokens(limits.network.chainId).map((asset) => ({ network, asset, amount }));
}

export function caip2(chainId: number) {
  return `eip155:${chainId}`;
}

export type FundingOptions = {
  policy: PaymentPolicy;
  funders?: readonly Funder<unknown>[] | undefined;
  /** Context the method already supplies; funder context is merged over it. */
  credentialContext?: unknown;
  /** Persisted by the caller before funding, so interrupted funding can be reconciled. */
  attemptId?: string | undefined;
  /** The account that signs the credential; funders refuse to fund any other. */
  payer?: string | undefined;
  signal?: AbortSignal | undefined;
};

/** The selected payment, normalized, and the funder that would prepare it; nothing moves. */
export async function planCharge(
  challenge: Challenge.Challenge,
  options: Pick<FundingOptions, "policy" | "funders">,
): Promise<PaymentPlan<unknown>> {
  return planPayment(mppxRequirement(challenge), {
    policy: options.policy,
    funders: options.funders ?? [],
  });
}

/**
 * Plans the charge, then has its funder (if any) prepare it, through machine-fetch's Mppx
 * extension: requirement, policy, funding, and credential context in one call.
 */
export async function planAndFund(challenge: Challenge.Challenge, options: FundingOptions) {
  const plan = await planCharge(challenge, options);
  const prepared = await extension({
    policy: options.policy,
    funders: options.funders ?? [],
  }).preparePayment({
    challenge,
    ...(options.credentialContext === undefined
      ? {}
      : { credentialContext: options.credentialContext }),
    ...(options.attemptId === undefined ? {} : { attemptId: options.attemptId }),
    ...(options.payer === undefined ? {} : { payer: options.payer }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return { plan, credentialContext: prepared?.credentialContext, funding: prepared?.funding };
}

/** How a machine-fetch failure is reported: the CLI error for its code, with its fix as `cta`. */
export type FundingErrorContext = {
  network: Network;
  /** The policy the payment was planned under. */
  policy: PaymentPolicy;
  /** The requirement the failure is about, when known; names the token in messages. */
  requirement?: PaymentRequirement | undefined;
  /** Raised for an amount over `--max-spend` in a capped token, with the rerun `cta`. */
  maxSpendExceeded(required: bigint): Errors.IncurError;
};

/**
 * Maps a machine-fetch error to the CLI's error codes (plan, Phase 1). Other errors pass through
 * unchanged. Messages from machine-fetch are its own, never upstream text, but are sanitized all
 * the same.
 */
export function fundingError(error: unknown, context: FundingErrorContext): unknown {
  if (!(error instanceof MachineFetchError)) return error;
  const message = sanitizeText(error.message);
  switch (error.code) {
    case "LIMIT_EXCEEDED":
      return limitError(message, context);
    case "INVALID_PAYMENT":
    case "NO_ROUTE":
    case "FUNDING_FAILED":
      return paymentError(message);
    case "INSUFFICIENT_FUNDS": {
      const command = continuationCommand(["wallet", "fund"], context.network);
      return new CtaError(
        commandError(
          "E_INSUFFICIENT_FUNDS",
          `${message}. Add funds with '${command}', then retry.`,
          command,
        ),
      );
    }
    case "RECOVERY_REQUIRED": {
      const operation =
        error instanceof FundingRecoveryError ? escapeInvisible(error.operationId) : "unknown";
      return walletError({
        code: "E_PAYMENT_OUTCOME_UNKNOWN",
        message: `${message}. Funding operation ${operation} may have moved funds; do not retry the payment until it is reconciled.`,
      });
    }
    case "STORE_FAILED":
    case "INVALID_CONFIGURATION":
    case "DISPOSED":
      return walletError({ code: "E_RUNTIME", message, cause: error });
  }
}

/**
 * A payment `maxPayment` refused: over `--max-spend` in a capped token, with the rerun `cta`, or in
 * a token `--max-spend` does not cap, which no rerun fixes.
 */
function limitError(message: string, context: FundingErrorContext) {
  const { policy, requirement } = context;
  const limits = Array.isArray(policy.maxPayment) ? policy.maxPayment : undefined;
  if (!requirement || !limits) return walletError({ code: "E_LIMIT_EXCEEDED", message });
  const limit = limits.find(
    (entry) =>
      entry.network === requirement.network &&
      entry.asset.toLowerCase() === requirement.asset.toLowerCase(),
  );
  if (limit) return context.maxSpendExceeded(requirement.amount);
  return walletError({
    code: "E_LIMIT_EXCEEDED",
    message: `--max-spend cannot cap a payment in ${escapeInvisible(requirement.asset)} on ${context.network.name}: it is not a USD token the CLI lists, so it was not paid`,
  });
}
