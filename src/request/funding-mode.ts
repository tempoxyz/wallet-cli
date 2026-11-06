import { usageError } from "../shared/errors.js";
import { configValue, type Config, type ConfigSource } from "../wallet/config.js";

/**
 * How `tempo request` may acquire a payment's token it does not hold: `tempo` swaps on the Tempo
 * DEX within the same transaction; `auto` may also fund other chains; `off` pays only from what
 * the wallet holds, as before funding existed.
 */
export type FundingMode = "auto" | "tempo" | "off";

export const fundingModes: readonly FundingMode[] = ["auto", "tempo", "off"];

/** Funding when none of `--funding`, `TEMPO_FUNDING`, and the saved `funding` is set. */
export const defaultFunding: FundingMode = "tempo";

export function parseFunding(value: string): FundingMode {
  if ((fundingModes as readonly string[]).includes(value)) return value as FundingMode;
  throw usageError(`funding must be one of: ${fundingModes.join(", ")}`);
}

/**
 * The funding mode and where it came from: `--funding`, then `TEMPO_FUNDING`, then the saved
 * `funding` in `config` (by default, the config file), then `defaultFunding`.
 */
export function fundingSetting(
  flag?: string,
  config?: Config,
): { value: FundingMode; source: ConfigSource } {
  if (flag !== undefined) return { value: parseFunding(flag), source: "flag" };
  const env = process.env.TEMPO_FUNDING?.trim() || undefined;
  if (env !== undefined) return { value: parseFunding(env), source: "env" };
  const saved = configValue("funding", parseFunding, config);
  return saved === undefined
    ? { value: defaultFunding, source: "default" }
    : { value: saved, source: "config" };
}

/** Maximum Tempo DEX slippage, in basis points, when `--max-slippage-bps` is not set. */
export const defaultMaxSlippageBps = 50;

export function parseMaxSlippageBps(value: number | undefined) {
  if (value === undefined) return defaultMaxSlippageBps;
  if (!Number.isInteger(value) || value < 0 || value > 10_000)
    throw usageError("--max-slippage-bps must be an integer from 0 to 10000");
  return value;
}
