import { z } from "incur";
import { getAddress, isAddress, type Address } from "viem";
import { tokens } from "viem/tokens";

import { usageError } from "./errors.js";

/**
 * The chains and tokens funding and payment policy trust. Server-supplied fields never add to
 * them: a payment in a token outside this table is refused, never funded.
 *
 * `TEMPO_DEV_CHAINS` (JSON) adds development entries, such as the local chains of `pnpm test:e2e`.
 * It is for local development only and never needed against mainnet or testnet; anyone who can set
 * it can already redirect every RPC call with `TEMPO_RPC_URL`.
 */

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), "must be a 0x address")
  .transform((value) => getAddress(value));

const devChainsSchema = z.object({
  /** Extra USD TIP-20s per Tempo chain ID. */
  tempo: z
    .record(z.string().regex(/^[1-9]\d*$/), z.object({ usdTokens: z.array(address).default([]) }))
    .default({}),
});

type DevChains = z.infer<typeof devChainsSchema>;

let cached: { raw: string | undefined; value: DevChains } | undefined;

/** The parsed `TEMPO_DEV_CHAINS`, or empty entries when it is unset; invalid JSON is E_USAGE. */
export function devChains(): DevChains {
  const raw = process.env.TEMPO_DEV_CHAINS?.trim() || undefined;
  if (cached && cached.raw === raw) return cached.value;
  let value: DevChains = { tempo: {} };
  if (raw !== undefined) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw usageError("TEMPO_DEV_CHAINS must be JSON");
    }
    const parsed = devChainsSchema.safeParse(json);
    if (!parsed.success)
      throw usageError(
        `TEMPO_DEV_CHAINS is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ")}`,
      );
    value = parsed.data;
  }
  cached = { raw, value };
  return value;
}

/**
 * The USD TIP-20s on Tempo chain `chainId` that `--max-spend` caps, checksummed: every USD token
 * viem lists for the chain, then `TEMPO_DEV_CHAINS` additions. MACH is not a USD token, so it is
 * never among them.
 */
export function tempoUsdTokens(chainId: number): Address[] {
  const listed = tokens.tempo.flatMap((token) => {
    const at = (token.addresses as Partial<Record<number, Address>>)[chainId];
    return token.currency === "USD" && at ? [getAddress(at)] : [];
  });
  const dev = devChains().tempo[String(chainId)]?.usdTokens ?? [];
  return [...new Set([...listed, ...dev])];
}
