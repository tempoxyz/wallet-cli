import { machineTokenDeployments } from "mppx/tempo";
import { isAddress, type Address, type HttpTransportConfig } from "viem";
import { Actions } from "viem/tempo";
import { tokens } from "viem/tokens";

import { networkError, usageError } from "./errors.js";
import { machDecimals } from "./mach.js";
import { createTempoPublicClient, parseNetwork, type Network } from "./network.js";
import { escapeInvisible, sanitizeText } from "./utils.js";

/** A token; `symbol` is `null` when an unlisted token's own symbol is not a plain ticker. */
export type Token = { address: Address; symbol: string | null; decimals: number };

type ListedToken = Token & { symbol: string };

type ReadMetadata = (address: Address) => Promise<{ decimals: number; symbol: string }>;

// Every symbol viem lists fits; an untrusted symbol that does not is never shown.
const tickerPattern = /^[A-Za-z0-9._-]{1,16}$/;

/** An untrusted token symbol, sanitized, when it is a plain ticker; otherwise `null`. */
export function tickerSymbol(value: string) {
  const symbol = sanitizeText(value);
  return tickerPattern.test(symbol) ? symbol : null;
}

/** How messages name a token: its symbol when known, else its lowercase address. */
export function tokenLabel(token: Token) {
  return token.symbol ?? token.address;
}

/** The tokens viem lists for `chainId`, plus MACH where it is deployed, with lowercase addresses. */
export function knownTokens(chainId: number): ListedToken[] {
  const listed = tokens.tempo.flatMap((token) => {
    const address = (token.addresses as Partial<Record<number, Address>>)[chainId];
    return address
      ? [
          {
            address: address.toLowerCase() as Address,
            symbol: token.symbol,
            decimals: token.decimals,
          },
        ]
      : [];
  });
  const mach = machineTokenDeployments[chainId as keyof typeof machineTokenDeployments];
  if (!mach) return listed;
  return [
    ...listed,
    { address: mach.token.toLowerCase() as Address, symbol: "MACH", decimals: machDecimals },
  ];
}

/** The listed symbol of the token at `address` on `chainId`. */
export function tokenSymbol(address: string, chainId: number) {
  return knownToken(address, chainId)?.symbol;
}

/**
 * Resolves a token argument to a lowercase address on `network`: a 0x address in any case, or a
 * symbol listed for the network, matched case-insensitively. When no listed token has the symbol,
 * a bridged token matches it without the `.e` suffix (`USDC` names `USDC.e`).
 */
export function resolveTokenAddress(input: string, network: Network, label = "token"): Address {
  if (/^0x/i.test(input)) {
    if (!isAddress(input, { strict: false }))
      throw usageError(`Invalid ${label} address: expected a full 0x address`);
    return input.toLowerCase() as Address;
  }
  const token = listedBySymbol(input, network.chainId);
  if (token) return token.address;
  const other = parseNetwork(network.name === "mainnet" ? "testnet" : "mainnet");
  const hint = listedBySymbol(input, other.chainId)
    ? ` (listed on ${other.name}; pass --network ${other.name})`
    : "";
  const symbols = knownTokens(network.chainId).map((known) => known.symbol);
  throw usageError(
    `Unknown ${label} ${escapeInvisible(JSON.stringify(input))} on ${network.name}${hint}. Use a 0x address or one of: ${symbols.join(", ")}`,
  );
}

/**
 * Checks a token symbol before its network is known: returns it when any network lists it, so it
 * can be resolved later, and otherwise fails listing every network's symbols.
 */
export function listedSymbol(symbol: string, label = "token") {
  const networks = [parseNetwork("mainnet"), parseNetwork("testnet")];
  if (networks.some((network) => listedBySymbol(symbol, network.chainId))) return symbol;
  const symbols = new Set(
    networks.flatMap((network) => knownTokens(network.chainId).map((token) => token.symbol)),
  );
  throw usageError(
    `Unknown ${label} ${escapeInvisible(JSON.stringify(symbol))}. Use a 0x address or one of: ${[...symbols].join(", ")}`,
  );
}

/**
 * The symbol and decimals of the token at `address`: viem's listing first, else read on chain.
 * On-chain symbols are untrusted, so only a plain ticker is kept (see `tickerSymbol`).
 */
export async function tokenMetadata(
  address: Address,
  chainId: number,
  read: ReadMetadata = (token) => readTokenMetadata(token, chainId),
): Promise<Token> {
  const known = knownToken(address, chainId);
  if (known) return known;
  const metadata = await read(address).catch(() => {
    throw networkError(
      `Unable to read token metadata for ${address}. Check the token address and RPC connectivity (TEMPO_RPC_URL).`,
    );
  });
  return { address, symbol: tickerSymbol(metadata.symbol), decimals: metadata.decimals };
}

/** Reads a TIP-20 token's decimals and unsanitized symbol on chain. */
export async function readTokenMetadata(
  address: Address,
  chainId: number,
  options: Pick<HttpTransportConfig, "timeout" | "retryCount"> = {},
) {
  const client = createTempoPublicClient(chainId, options);
  const { decimals, symbol } = await Actions.token.getMetadata(client, { token: address });
  return { decimals, symbol };
}

/** The listed token at `address` on `chainId`. */
export function knownToken(address: string, chainId: number) {
  const lower = address.toLowerCase();
  return knownTokens(chainId).find((token) => token.address === lower);
}

function listedBySymbol(symbol: string, chainId: number) {
  const listed = knownTokens(chainId);
  const lower = symbol.toLowerCase();
  return (
    listed.find((token) => token.symbol === symbol) ??
    listed.find((token) => token.symbol.toLowerCase() === lower) ??
    listed.find((token) => token.symbol.toLowerCase() === `${lower}.e`)
  );
}
