import { z } from "incur";
import { createPublicClient, erc20Abi, getAddress, http, isAddress, type Address } from "viem";
import { ousd, pathusd, tokens, usdc, usdce } from "viem/tokens";

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

const chainIdKey = z.string().regex(/^[1-9]\d*$/);

const devDestinationSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string().regex(/^[a-z0-9-]{1,32}$/),
  rpcUrl: z.string().url(),
  usdc: z.object({ address, name: z.string().min(1), version: z.string().min(1) }),
});

const devChainsSchema = z.object({
  /**
   * Per Tempo chain ID: extra USD TIP-20s, the tokens funding swaps from, in order, and the EVM
   * chains its payments may be made on.
   */
  tempo: z
    .record(
      chainIdKey,
      z.object({
        usdTokens: z.array(address).default([]),
        fundingInputs: z.array(address).optional(),
        destinations: z.array(devDestinationSchema).default([]),
      }),
    )
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
  const canonical = chainId === moderato ? [moderatoOusd] : [];
  const dev = devChains().tempo[String(chainId)]?.usdTokens ?? [];
  return [...new Set([...listed, ...canonical, ...dev])];
}

const mainnet = 4217;
const moderato = 42431;
/** OUSD has the same address on Tempo mainnet and Moderato; viem lists only mainnet's. */
const moderatoOusd = getAddress(ousd.addresses[mainnet]);

/**
 * The tokens a Tempo DEX swap may spend to buy a payment's token on `chainId`, most preferred
 * first: OUSD, then USDC.e, then pathUSD (D4), or the `TEMPO_DEV_CHAINS` inputs. Empty on a chain
 * without them.
 */
export function tempoFundingInputs(chainId: number): Address[] {
  const dev = devChains().tempo[String(chainId)]?.fundingInputs;
  if (dev) return dev;
  if (chainId !== mainnet && chainId !== moderato) return [];
  return [
    getAddress(ousd.addresses[mainnet]),
    getAddress(usdce(chainId).address),
    getAddress(pathusd(chainId).address),
  ];
}

/**
 * An EVM chain the CLI pays on with its remote payer key (D2), and the only token it pays there:
 * USDC, with the EIP-3009 domain its authorizations are signed under.
 */
export type Destination = {
  chainId: number;
  /** A short name for messages and `--payment-network`, such as `base`. */
  name: string;
  /** CAIP-2 network, `eip155:<chainId>`. */
  network: `eip155:${number}`;
  usdc: { address: Address; decimals: number; name: string; version: string };
  /** The RPC endpoint balance reads use. */
  rpcUrl: string;
};

const base: Omit<Destination, "rpcUrl"> = {
  chainId: 8453,
  name: "base",
  network: "eip155:8453",
  usdc: {
    address: getAddress(usdc.addresses[8453]),
    decimals: 6,
    name: "USD Coin",
    version: "2",
  },
};

const baseSepolia: Omit<Destination, "rpcUrl"> = {
  chainId: 84532,
  name: "base-sepolia",
  network: "eip155:84532",
  usdc: {
    address: getAddress(usdc.addresses[84532]),
    decimals: 6,
    name: "USDC",
    version: "2",
  },
};

/**
 * The EVM chains payments from Tempo chain `tempoChainId` may be made on: Base for mainnet, Base
 * Sepolia for testnet, then `TEMPO_DEV_CHAINS` destinations. Server-supplied offers on any other
 * chain, or in any other token, are never paid.
 */
export function destinations(tempoChainId: number): Destination[] {
  const listed = tempoChainId === mainnet ? [base] : tempoChainId === moderato ? [baseSepolia] : [];
  const dev = (devChains().tempo[String(tempoChainId)]?.destinations ?? []).map(
    (entry): Destination => ({
      chainId: entry.chainId,
      name: entry.name,
      network: `eip155:${entry.chainId}`,
      usdc: { ...entry.usdc, decimals: 6 },
      rpcUrl: entry.rpcUrl,
    }),
  );
  return [...listed.map((entry) => ({ ...entry, rpcUrl: destinationRpcUrl(entry) })), ...dev];
}

/** The destination for `chainId` among `tempoChainId`'s, if payments may be made there. */
export function destination(tempoChainId: number, chainId: number) {
  return destinations(tempoChainId).find((entry) => entry.chainId === chainId);
}

/** `TEMPO_BASE_RPC_URL` for Base, else the chain's public endpoint. */
function destinationRpcUrl(entry: Omit<Destination, "rpcUrl">) {
  if (entry.chainId === base.chainId && process.env.TEMPO_BASE_RPC_URL)
    return process.env.TEMPO_BASE_RPC_URL;
  return entry.chainId === base.chainId ? "https://mainnet.base.org" : "https://sepolia.base.org";
}

/** `owner`'s USDC balance on `destination`, in atomic units; rejects when it cannot be read. */
export function destinationBalance(destination: Destination, owner: Address) {
  return createPublicClient({
    transport: http(destination.rpcUrl, { retryCount: 1 }),
  }).readContract({
    address: destination.usdc.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}
