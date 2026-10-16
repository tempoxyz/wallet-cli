import { erc20Abi, formatUnits, type Address } from "viem";
import { Actions } from "viem/tempo";

import {
  createTempoPublicClient,
  networkFields,
  rpcUrlOverride,
  tokenAddress,
} from "../shared/network.js";
import { knownToken, readTokenMetadata, tokenMetadata } from "../shared/tokens.js";
import { cleanStoredScalar, formatTokenUnits, formatUnixTimestamp } from "../shared/utils.js";
import { localAccessKeyStatus } from "./access-key.js";
import type { WalletState } from "./store.js";

/**
 * `balance` is `undefined` when it was not queried and `null` when the query failed; `chainKey` is
 * `undefined` when the key was not read on chain.
 */
export function currentKeyOutput(
  key: WalletState["accessKeys"][number],
  balance: TokenBalance | null | undefined,
  details: TokenDetails,
  chainKey?: ChainKey,
) {
  const limit = key.limits?.[0];
  const spendingMode = permissionMode(key.limits, key.permissionSemantics);
  const callMode = permissionMode(key.scopes, key.permissionSemantics);
  const token = limit?.token ?? tokenAddress(key.chainId);
  const tokenDetail = details.get(tokenKey(key.chainId, token));
  const spendingLimits = accessKeyLimitsOutput(key, details, chainKey);
  const first = spendingLimits[0];
  const published = chainKey?.published ?? null;
  const status = localAccessKeyStatus(key);
  return {
    address: key.address.toLowerCase(),
    ...networkFields(key.chainId),
    wallet_address: key.access.toLowerCase(),
    symbol: tokenDetail?.symbol ?? null,
    token: token.toLowerCase(),
    balance:
      balance && balance.token.toLowerCase() === token.toLowerCase() ? balance.formatted : null,
    ...(balance === null ? { balance_error: balanceQueryError } : {}),
    // Deprecated: the key's permission mode with `spending_limits[0]`.
    spending_limit: {
      mode: spendingMode,
      unlimited: spendingMode === "unknown" ? null : spendingMode === "unrestricted",
      limit: spendingMode === "none" ? "0.000000" : (first?.limit ?? null),
      raw_limit: spendingMode === "none" ? "0" : (first?.raw_limit ?? null),
      period_seconds: first?.period_seconds ?? null,
      remaining: first?.remaining ?? null,
      spent: first?.spent ?? null,
    },
    spending_limits: spendingLimits,
    call_permissions: callMode,
    scopes: accessKeyScopesOutput(key),
    // The stored authorization of a key the chain holds was already published.
    status: status === "pending" && published ? "ready" : status,
    published,
    expires_at: formatUnixTimestamp(key.expiry),
  };
}

/**
 * A key's spending limits as `whoami` and `keys list` format them, without reading tokens on
 * chain: a token viem does not list has no `symbol` or formatted `limit`, only its `raw_limit`.
 */
export async function keySpendingLimits(key: WalletState["accessKeys"][number]) {
  return accessKeyLimitsOutput(key, await tokenDetails(keyTokens(key, false)));
}

/**
 * `remaining` is the chain's, when `chainKey` has it. `spent` is always `null`: the chain exposes
 * only what remains, not the limit it counts down from, and another wallet client can change that
 * limit, so the stored one cannot be proven current.
 */
function accessKeyLimitsOutput(
  key: WalletState["accessKeys"][number],
  details: TokenDetails,
  chainKey?: ChainKey,
) {
  return (key.limits ?? []).map((limit) => {
    const detail = details.get(tokenKey(key.chainId, limit.token));
    const remaining = chainKey?.remaining.get(limit.token.toLowerCase()) ?? null;
    return {
      unlimited: false,
      symbol: detail?.symbol ?? null,
      token: limit.token.toLowerCase(),
      limit: formatLimit(limit.limit, detail),
      raw_limit: cleanStoredScalar(limit.limit),
      period_seconds: limit.period ?? null,
      remaining: remaining === null ? null : formatLimit(remaining.toString(), detail),
      spent: null,
    };
  });
}

/**
 * A key as the AccountKeychain precompile holds it. `published` is whether the chain holds the key
 * unrevoked, `null` when the read failed or reached another chain. Remaining limits are keyed by
 * lowercase token.
 */
type ChainKey = { published: boolean | null; remaining: Map<string, bigint | null> };

/**
 * Whether reads for a chain reach it. `TEMPO_RPC_URL` or a saved `rpc-url` serves every network,
 * so with one set each distinct chain asks the endpoint's `eth_chainId` once, bounded and without
 * retries, and a failed call counts as another chain. The per-chain default URLs need no check.
 */
export function rpcChainCheck() {
  const checks = new Map<number, Promise<boolean>>();
  return (chain: number) => {
    if (!rpcUrlOverride()) return Promise.resolve(true);
    let check = checks.get(chain);
    if (!check) {
      const client = createTempoPublicClient(chain, { timeout: statusQueryTimeout, retryCount: 0 });
      check = (async () => (await client.getChainId()) === chain)().catch(() => false);
      checks.set(chain, check);
    }
    return check;
  };
}

/**
 * Reads a key on its own chain, trusting the reads only once `servesChain` confirms the RPC is on
 * it. Remaining limits are read only for a published key whose limits the chain enforces, since a
 * key the chain does not hold reads as zero remaining. Each read is bounded and not retried, and a
 * failed one is `null`.
 */
export async function readChainKey(
  key: WalletState["accessKeys"][number],
  servesChain: (chain: number) => Promise<boolean>,
): Promise<ChainKey> {
  const client = createTempoPublicClient(key.chainId, {
    timeout: statusQueryTimeout,
    retryCount: 0,
  });
  const account = key.access as Address;
  const accessKey = key.address as Address;
  const [onChain, metadata] = await Promise.all([
    servesChain(key.chainId),
    Actions.accessKey.getMetadata(client, { account, accessKey }).catch(() => undefined),
  ]);
  const published =
    onChain && metadata
      ? !metadata.isRevoked && metadata.address.toLowerCase() === accessKey.toLowerCase()
      : null;
  if (!published || metadata?.spendPolicy !== "limited") return { published, remaining: new Map() };
  const tokens = new Set((key.limits ?? []).map((limit) => limit.token.toLowerCase() as Address));
  const remaining = await Promise.all(
    [...tokens].map(async (token) => {
      const value = await Actions.accessKey
        .getRemainingLimit(client, { account, accessKey, token })
        .then(
          (result) => result.remaining,
          () => null,
        );
      return [token, value] as const;
    }),
  );
  return { published, remaining: new Map(remaining) };
}

/**
 * A stored raw limit in the token's decimals, or `null` when they are unknown; a value that is not
 * an integer is shown as stored.
 */
function formatLimit(value: string, detail: TokenDetail | undefined) {
  const raw = cleanStoredScalar(value);
  if (!/^\d+$/.test(raw)) return raw;
  const decimals = detail?.decimals ?? null;
  return decimals === null ? null : formatTokenUnits(BigInt(raw), decimals);
}

function accessKeyScopesOutput(key: WalletState["accessKeys"][number]) {
  return (key.scopes ?? []).map((scope) => ({
    address: scope.address.toLowerCase(),
    selector: scope.selector ?? null,
    // Omitted and empty recipient lists both allow any recipient.
    recipients: scope.recipients?.map((recipient) => recipient.toLowerCase()) ?? [],
  }));
}

function permissionMode(values: readonly unknown[] | undefined, semantics: 1 | undefined) {
  if (semantics !== 1) return "unknown" as const;
  if (values === undefined) return "unrestricted" as const;
  return values.length === 0 ? ("none" as const) : ("restricted" as const);
}

export type TokenBalance = {
  formatted: string;
  raw: bigint;
  token: string;
};

type TokenDetail = { symbol: string | null; decimals: number | null };
type TokenDetails = Map<string, TokenDetail>;

const unknownToken: TokenDetail = { symbol: null, decimals: null };

export function tokenKey(chain: number, token: string) {
  return `${chain}:${token.toLowerCase()}`;
}

/**
 * A key's primary token, then each token it has a limit for, on the key's chain. `read` allows an
 * unlisted token to be read on chain.
 */
export function keyTokens(key: WalletState["accessKeys"][number], read = true) {
  return [
    key.limits?.[0]?.token ?? tokenAddress(key.chainId),
    ...(key.limits ?? []).map((limit) => limit.token),
  ].map((token) => ({ chain: key.chainId, token, read }));
}

/**
 * Display symbols and decimals by `tokenKey`: viem's listing, else read on chain when an entry
 * allows it, kept only once `servesChain` confirms the RPC is on that chain. A token not read,
 * unreadable, or read on another chain has neither. Each distinct chain and token is looked up
 * once, and the lookups run in parallel.
 */
export async function tokenDetails(
  tokens: readonly { chain: number; token: string; read: boolean }[],
  servesChain: (chain: number) => Promise<boolean> = rpcChainCheck(),
): Promise<TokenDetails> {
  const unique = new Map<string, (typeof tokens)[number]>();
  for (const entry of tokens) {
    const id = tokenKey(entry.chain, entry.token);
    unique.set(id, { ...entry, read: entry.read || unique.get(id)?.read === true });
  }
  const details = await Promise.all(
    [...unique].map(async ([id, { chain, token, read }]) => {
      const listed = knownToken(token, chain) !== undefined;
      if (!read && !listed) return [id, unknownToken] as const;
      const readOnChain = (address: Address) =>
        readTokenMetadata(address, chain, { timeout: statusQueryTimeout, retryCount: 0 });
      const [served, detail] = await Promise.all([
        listed || servesChain(chain),
        tokenMetadata(token.toLowerCase() as Address, chain, readOnChain).then(
          ({ symbol, decimals }): TokenDetail => ({ symbol, decimals }),
          () => unknownToken,
        ),
      ]);
      return [id, served ? detail : unknownToken] as const;
    }),
  );
  return new Map(details);
}

// Status queries should return promptly even when an upstream service stalls.
export const statusQueryTimeout = 3_000;

export const balanceQueryError = {
  code: "E_RPC" as const,
  message: "Unable to query token balance. Check RPC connectivity and TEMPO_RPC_URL.",
};

/**
 * The wallet's balance of `token` on `chain`; `null` without a wallet, when the read fails, or when
 * `servesChain` finds the RPC on another chain, so a balance is never another chain's.
 */
export async function tokenBalance(options: {
  chain: number;
  token: string;
  walletAddress: string | null;
  servesChain: (chain: number) => Promise<boolean>;
}): Promise<TokenBalance | null> {
  const { walletAddress } = options;
  if (!walletAddress) return null;
  const read = async () => {
    const client = createTempoPublicClient(options.chain, {
      timeout: statusQueryTimeout,
      retryCount: 0,
    });
    return await client.readContract({
      address: options.token as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress as Address],
    });
  };
  // The read and the chain check run together, as for key state; only a confirmed chain counts.
  const [served, raw] = await Promise.all([
    options.servesChain(options.chain),
    read().catch(() => undefined),
  ]);
  if (!served || raw === undefined) return null;
  return { formatted: formatUnits(raw, 6), raw, token: options.token };
}
