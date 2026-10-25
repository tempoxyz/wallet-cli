import type { Errors } from "incur";
import { Errors as PolicyErrors, Funder, Payment, Policy } from "machine-fetch";
import { MppxFetch } from "machine-fetch/mppx";
import type { Challenge } from "mppx";
import type { Transport } from "mppx/client";
import { parseUnits } from "viem";
import { defineToken, ousd } from "viem/tokens";

import { paymentError, paymentOutcomeUnknownError, walletError } from "../shared/errors.js";
import { sanitizeText } from "../shared/utils.js";
import { challengeAmount } from "./challenge.js";
import { isMachPaymentToken } from "./mach.js";
import type { RequestOptions } from "./options.js";
import { formatTokenAmount, MaxSpendExceededError, spendCap } from "./spend.js";

/**
 * OUSD on every Tempo network the CLI pays on. Viem lists only its mainnet address; Moderato
 * (42431) has it at the same address.
 */
const tempoOusd = defineToken({
  ...ousd,
  addresses: { 4217: ousd.addresses[4217], 42431: ousd.addresses[4217] },
});

/**
 * machine-fetch's spending policy for a charge: the spending cap as a ceiling in the challenge's
 * own token, in its atomic units with 6 decimals, as `--max-spend` has always been read. The
 * ceiling names the token wallet-cli validated, so a challenge mppx selects in another token, or
 * for more, is refused before signing.
 */
export function chargePolicy(challenge: Challenge.Challenge, options: RequestOptions) {
  const { network, asset } = MppxFetch.requirement(challenge);
  return {
    maxPayment: [{ network, asset, amount: parseUnits(spendCap(options), 6) }],
  } as const;
}

/**
 * Signs a charge credential through machine-fetch: mppx selects the challenge, machine-fetch checks
 * it against `chargePolicy` and prepares its funding (a Tempo auto-swap from OUSD when the wallet
 * lacks the requested stablecoin), and only then does mppx sign. Any refusal stops signing, unlike
 * an mppx `challenge.received` listener, whose errors mppx ignores. An explicit MACH payment never
 * swaps from stablecoins. A refusal is mapped to the CLI's error codes by `chargePolicyError`.
 */
export async function createChargeCredential<transport extends Transport.AnyTransport>(
  mppx: MppxFetch.CredentialClient<transport>,
  response: Transport.ResponseOf<transport>,
  options: {
    /** The challenge wallet-cli validated, the only one `response` offers. */
    challenge: Challenge.Challenge;
    /** The account the charge pays from. */
    payer: string;
    request: RequestOptions;
  },
) {
  const extension = MppxFetch.extension({
    ...chargePolicy(options.challenge, options.request),
    autoSwap: isMachPaymentToken(options.request.paymentToken)
      ? false
      : { tokens: [tempoOusd], only: true },
  });
  // The challenge mppx selected, so a refusal names the amount policy saw.
  let selected = options.challenge;
  const client: MppxFetch.CredentialClient<transport> = {
    async preparePayment(response) {
      const payment = await mppx.preparePayment(response);
      selected = payment.challenge;
      return payment;
    },
  };
  try {
    return await MppxFetch.createCredential(client, response, {
      extension,
      // Tempo funding is atomic with the signed charge, so there is no funding to recover after a
      // crash and a fresh operation per payment is enough.
      operationId: crypto.randomUUID(),
      payer: options.payer,
    });
  } catch (error) {
    throw chargePolicyError(error, selected, options.request) ?? error;
  }
}

/**
 * The CLI error for a machine-fetch refusal, or `undefined` for any other error. Every refusal
 * happens before signing, except `Funder.FundingRecoveryError`, which says funds may have moved.
 */
export function chargePolicyError(
  error: unknown,
  challenge: Challenge.Challenge,
  options: RequestOptions,
): Errors.IncurError | undefined {
  if (!(error instanceof PolicyErrors.BaseError)) return undefined;
  const reason = sanitizeText(error.shortMessage);
  if (error instanceof Policy.LimitExceededError) {
    const amount = amountOf(challenge);
    if (amount !== undefined && amount > parseUnits(spendCap(options), 6))
      return new MaxSpendExceededError(amount, options);
    return walletError({
      code: "E_LIMIT_EXCEEDED",
      message: `Payment refused by the spending policy: ${reason}`,
    });
  }
  if (error instanceof Policy.InvalidPaymentError)
    return paymentError(`Payment challenge refused: ${reason}`);
  if (error instanceof Funder.FundingRecoveryError)
    return paymentOutcomeUnknownError(
      `Funding the payment may have moved funds (operation ${sanitizeText(error.operationId)}). Check the wallet's balance before paying again.`,
    );
  const refusal = Funder.cheapestRefusal(error);
  if (refusal instanceof Funder.FundingLimitError)
    return walletError({
      code: "E_LIMIT_EXCEEDED",
      message: `Funding the payment needs ${formatTokenAmount(refusal.required)} of ${sanitizeText(refusal.asset)}, above the ${refusal.setting === "spendLimit" ? "access key's remaining spending limit" : "funding limit"} of ${formatTokenAmount(refusal.limit)}`,
    });
  if (
    refusal instanceof Funder.SourceBalanceError ||
    error instanceof Funder.InsufficientFundsError
  )
    return walletError({
      code: "E_INSUFFICIENT_FUNDS",
      message: `Insufficient balance to fund the payment: ${reason}`,
    });
  // No funds moved, so a transient funding failure may be retried; no route stays unpayable.
  if (error instanceof Funder.FundingError)
    return walletError({
      code: "E_PAYMENT",
      message: `Payment funding failed: ${reason}`,
      retryable: !(error instanceof Funder.NoRouteError),
    });
  return paymentError(`Payment refused before signing: ${reason}`);
}

/**
 * Whether a charge fits the spending cap, by the same policy the payment applies; `--dry-run`
 * reports it as `within_budget`.
 */
export async function chargeWithinMaxSpend(
  challenge: Challenge.Challenge,
  options: RequestOptions,
) {
  try {
    await Payment.plan(MppxFetch.requirement(challenge), chargePolicy(challenge, options));
    return true;
  } catch (error) {
    if (error instanceof Policy.PaymentPolicyError) return false;
    throw error;
  }
}

function amountOf(challenge: Challenge.Challenge) {
  try {
    return challengeAmount(challenge);
  } catch {
    return undefined;
  }
}
