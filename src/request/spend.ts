import { Errors } from "incur";
import { parseUnits } from "viem";

import { errorCodes, paymentError, usageError } from "../shared/errors.js";
import type { Network } from "../shared/network.js";
import { requestNetwork } from "./identity.js";
import type { RequestOptions } from "./options.js";

/**
 * Spending cap, in payment token units, when neither `--max-spend` nor `TEMPO_MAX_SPEND` is set.
 * It bounds each charge, each session deposit, and a session's cumulative vouchers.
 */
export const defaultMaxSpend = "10";

export function resolveMaxSpend(value?: string) {
  const maxSpend = value ?? (process.env.TEMPO_MAX_SPEND?.trim() || undefined);
  if (maxSpend !== undefined && !/^\d+(?:\.\d{1,6})?$/.test(maxSpend))
    throw usageError(
      "--max-spend (or TEMPO_MAX_SPEND) must be a non-negative amount with at most 6 decimal places",
    );
  return maxSpend;
}

export function enforceMaxSpend(
  challenge: { intent: string; request: Record<string, unknown> },
  options: RequestOptions,
) {
  const amount = challenge.request.amount;
  if (typeof amount !== "string" || !/^\d+$/.test(amount))
    throw paymentError("Payment challenge is missing a valid amount");
  // An explicit cap already refused the subscription, and the default cap leaves recurring
  // offers to the per-period limit the wallet signs.
  if (challenge.intent === "subscription") return;
  assertWithinMaxSpend(BigInt(amount), options);
}

/** `--max-spend`, then `TEMPO_MAX_SPEND`, then `defaultMaxSpend`, in payment token units. */
export function spendCap(options: RequestOptions) {
  return options.maxSpend ?? defaultMaxSpend;
}

export function spendCapLabel(options: RequestOptions) {
  return options.maxSpend ?? `${defaultMaxSpend} (default)`;
}

/** Refuses an amount, deposit, or cumulative voucher (raw token units) above the spending cap. */
export function assertWithinMaxSpend(required: bigint, options: RequestOptions) {
  if (required > parseUnits(spendCap(options), 6))
    throw new MaxSpendExceededError(required, options);
}

/**
 * A charge, deposit, or voucher over the spending cap, refused before it is signed. The
 * request CLI suggests rerunning the command with `--max-spend <required>`.
 */
export class MaxSpendExceededError extends Errors.IncurError {
  /** The smallest `--max-spend` that allows the payment. */
  readonly required: string;
  /** The network the payment would use. */
  readonly network: Network;
  /** A one-time charge within the cap that the server also offered, when a session is refused. */
  charge: string | undefined = undefined;

  constructor(required: bigint, options: RequestOptions) {
    const { exitCode, retryable } = errorCodes.E_LIMIT_EXCEEDED;
    super({
      code: "E_LIMIT_EXCEEDED",
      exitCode,
      retryable,
      message: `Payment max spend exceeded: max=${spendCapLabel(options)} required=${formatTokenAmount(required)}`,
    });
    this.required = formatTokenAmount(required);
    this.network = requestNetwork(options);
  }
}

export function formatTokenAmount(value: bigint) {
  const whole = value / 1_000_000n;
  const fractional = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}
