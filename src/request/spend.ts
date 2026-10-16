import { Errors } from "incur";
import { parseUnits } from "viem";

import { errorCodes, paymentError, usageError } from "../shared/errors.js";
import type { Network } from "../shared/network.js";
import { configValue, type ConfigSource } from "../wallet/config.js";
import { requestNetwork } from "./identity.js";
import type { RequestOptions } from "./options.js";

/**
 * Spending cap, in payment token units, when none of `--max-spend`, `TEMPO_MAX_SPEND`, and the
 * config file's `max-spend` is set. It bounds each charge, each session deposit, and a session's
 * cumulative vouchers.
 */
export const defaultMaxSpend = "10";

const amountPattern = /^\d+(?:\.\d{1,6})?$/;

/** The explicit spending cap, or `undefined` when only `defaultMaxSpend` applies. */
export function resolveMaxSpend(value?: string) {
  const { value: maxSpend, source } = maxSpendSetting(value);
  return source === "default" ? undefined : maxSpend;
}

/**
 * The spending cap and where it came from: `--max-spend`, then `TEMPO_MAX_SPEND`, then the config
 * file's `max-spend`, then `defaultMaxSpend`.
 */
export function maxSpendSetting(flag?: string): { value: string; source: ConfigSource } {
  const env = process.env.TEMPO_MAX_SPEND?.trim() || undefined;
  const explicit = flag ?? env;
  if (explicit !== undefined) {
    if (!amountPattern.test(explicit))
      throw usageError(
        "--max-spend (or TEMPO_MAX_SPEND) must be a non-negative amount with at most 6 decimal places",
      );
    return { value: explicit, source: flag !== undefined ? "flag" : "env" };
  }
  const saved = configValue("max-spend", parseMaxSpend);
  return saved === undefined
    ? { value: defaultMaxSpend, source: "default" }
    : { value: saved, source: "config" };
}

/**
 * Checks a `max-spend` setting: an amount `--max-spend` takes, but positive, since a saved cap of
 * zero would refuse every payment.
 */
export function parseMaxSpend(value: string) {
  if (!amountPattern.test(value) || parseUnits(value, 6) === 0n)
    throw usageError("max-spend must be a positive amount with at most 6 decimal places");
  return value;
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

/** The spending cap in payment token units: the explicit cap, else `defaultMaxSpend`. */
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
