import { Errors } from "incur";
import { Errors as MachineFetchErrors, Funder, Payment, Policy } from "machine-fetch";
import { MppxFetch } from "machine-fetch/mppx";
import type { Challenge } from "mppx";
import { formatUnits, parseUnits } from "viem";

import { CtaError } from "../cli/incur-compat.js";
import { commandError, paymentError, walletError } from "../shared/errors.js";
import { tempoUsdTokens } from "../shared/chains.js";
import { tokenSymbol } from "../shared/tokens.js";
import type { Network } from "../shared/network.js";
import { continuationCommand } from "../shared/next.js";
import { escapeInvisible, sanitizeText } from "../shared/utils.js";

/** Every error among `error`'s causes, breadth first, including an AggregateError's errors. */
function causes(error: unknown): Error[] {
  const seen = new Set<unknown>();
  const queue = [error];
  const found: Error[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!(current instanceof Error) || seen.has(current)) continue;
    seen.add(current);
    found.push(current);
    queue.push(current.cause, ...(current instanceof AggregateError ? current.errors : []));
  }
  return found;
}

/**
 * Why each route declined, for a no-route error: the leaf causes' messages, sanitized, deduplicated
 * and bounded, since they quote provider responses.
 */
function routeReasons(error: unknown) {
  const leaves = causes(error)
    .slice(1)
    .filter((cause) => !(cause instanceof AggregateError) && cause.message)
    .map((cause) => sanitizeText(cause.message).slice(0, 160));
  return [...new Set(leaves)].slice(0, 3);
}

/**
 * Payment funding through machine-fetch: every charge credential is created only after
 * `Payment.plan` has checked it against policy, and only with the context its funder prepared.
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
): Policy.Policy {
  if (challenge.intent === "subscription" || challenge.request.amount === "0") return {};
  return { maxPayment: maxPaymentAssets(limits) };
}

/** `maxSpend` of each USD token the CLI trusts on `limits.network`, as machine-fetch asset limits. */
export function maxPaymentAssets(limits: SpendLimits): Policy.AssetAmount[] {
  const amount = parseUnits(limits.maxSpend, 6);
  const network = caip2(limits.network.chainId);
  return tempoUsdTokens(limits.network.chainId).map((asset) => ({ network, asset, amount }));
}

export function caip2(chainId: number) {
  return `eip155:${chainId}`;
}

export type FundingOptions = {
  policy: Policy.Policy;
  funders?: readonly Funder.Funder<unknown>[] | undefined;
  /** Context the method already supplies; funder context is merged over it. */
  credentialContext?: unknown;
  /** Persisted by the caller before funding, so interrupted funding can be reconciled. */
  operationId?: string | undefined;
  /** The account that signs the credential; funders refuse to fund any other. */
  payer?: string | undefined;
  signal?: AbortSignal | undefined;
};

/** The selected payment, normalized, and the funder that would prepare it; nothing moves. */
export async function planCharge(
  challenge: Challenge.Challenge,
  options: Pick<FundingOptions, "policy" | "funders">,
): Promise<Payment.Plan<unknown>> {
  return Payment.plan(MppxFetch.requirement(challenge), {
    ...options.policy,
    funders: options.funders ?? [],
  });
}

/**
 * Plans the charge, then has its funder (if any) prepare it, through machine-fetch's Mppx
 * extension: requirement, policy, funding, and credential context in one call. The extension's
 * own Tempo auto-swap is off: the CLI's Tempo funder swaps only from inputs the access key may
 * spend, and `--funding off` must never swap.
 */
export async function planAndFund(challenge: Challenge.Challenge, options: FundingOptions) {
  const plan = await planCharge(challenge, options);
  const prepared = await MppxFetch.extension({
    ...options.policy,
    funders: options.funders ?? [],
    autoSwap: false,
  }).preparePayment({
    challenge,
    ...(options.credentialContext === undefined
      ? {}
      : { credentialContext: options.credentialContext }),
    ...(options.operationId === undefined ? {} : { operationId: options.operationId }),
    ...(options.payer === undefined ? {} : { payer: options.payer }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return { plan, credentialContext: prepared?.credentialContext, funding: prepared?.funding };
}

/** How a machine-fetch failure is reported: the CLI error for its code, with its fix as `cta`. */
export type FundingErrorContext = {
  network: Network;
  /** The policy the payment was planned under. */
  policy: Policy.Policy;
  /** The requirement the failure is about, when known; names the token in messages. */
  requirement?: Payment.Requirement | undefined;
  /** Raised for an amount over `--max-spend` in a capped token, with the rerun `cta`. */
  maxSpendExceeded(required: bigint): Errors.IncurError;
};

/**
 * Maps a machine-fetch error to the CLI's error codes (plan, Phase 1). Other errors pass through
 * unchanged. Messages from machine-fetch are its own, never upstream text, but are sanitized all
 * the same.
 */
export function fundingError(error: unknown, context: FundingErrorContext): unknown {
  if (!(error instanceof MachineFetchErrors.BaseError)) return error;
  // The one-line summary: machine-fetch's full message adds a hint and a docs link.
  const message = sanitizeText(error.shortMessage);
  if (error instanceof Policy.LimitExceededError) return limitError(message, context);
  if (
    error instanceof Funder.NoRouteError ||
    error instanceof Funder.FundingLimitError ||
    error instanceof Funder.SourceBalanceError
  ) {
    // A route refused by the cap could run if it were raised: report the cheapest such route.
    // Only when every route fell short of the wallet's balance is it a funding shortfall.
    const symbol = (asset: string | undefined) =>
      (asset && tokenSymbol(asset, context.network.chainId)) || "of the source token";
    const limit = Funder.cheapestRefusal(error, Funder.FundingLimitError);
    if (limit)
      return walletError({
        code: "E_LIMIT_EXCEEDED",
        message: `Cross-chain funding needs up to ${formatUnits(limit.required, 6)} ${symbol(limit.asset)}, the bridge's fee and gas included, above --max-funding-spend. Review it, then rerun with --max-funding-spend ${formatUnits(limit.required, 6)}; nothing was sent.`,
      });
    const short = Funder.cheapestRefusal(error, Funder.SourceBalanceError);
    if (short) {
      const command = continuationCommand(["wallet", "fund"], context.network);
      return new CtaError(
        commandError(
          "E_INSUFFICIENT_FUNDS",
          `Cross-chain funding needs ${formatUnits(short.required, 6)} ${symbol(short.asset)}, the bridge's fee included, and the wallet holds ${formatUnits(short.held, 6)}; nothing was sent. Add funds with '${command}', then retry.`,
          command,
        ),
      );
    }
    const reasons = routeReasons(error);
    return paymentError(reasons.length > 0 ? `${message}: ${reasons.join("; ")}` : message);
  }
  if (error instanceof Funder.InsufficientFundsError) {
    const command = continuationCommand(["wallet", "fund"], context.network);
    return new CtaError(
      commandError(
        "E_INSUFFICIENT_FUNDS",
        `${message}. Add funds with '${command}', then retry.`,
        command,
      ),
    );
  }
  if (error instanceof Funder.FundingRecoveryError) {
    const operation = escapeInvisible(error.operationId);
    const command = continuationCommand(
      ["wallet", "funding", "recover", error.operationId],
      context.network,
    );
    return new CtaError(
      commandError(
        "E_PAYMENT_OUTCOME_UNKNOWN",
        `${message}. Funding operation ${operation} may have moved funds; do not pay again until '${command}' reconciles it.`,
        command,
      ),
    );
  }
  // Checked after its subclasses above: a plain funding failure moved nothing.
  if (error instanceof Policy.InvalidPaymentError || error instanceof Funder.FundingError)
    return paymentError(message);
  // Invalid configuration, a store failure, or a disposed wrapper: the CLI's own fault.
  return walletError({ code: "E_RUNTIME", message, cause: error });
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
