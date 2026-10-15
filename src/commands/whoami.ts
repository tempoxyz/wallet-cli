import { Cli } from "incur";
import { formatUnits, isAddress } from "viem";

import { readOnly, type WalletCommand } from "../cli/command.js";
import { flag } from "../cli/describe.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import { whoamiOptions, whoamiOutput } from "../schemas/whoami.js";
import {
  appUrl,
  networkFields,
  resolveNetwork,
  storedChainId,
  tokenAddress,
  type Network,
} from "../shared/network.js";
import { usageError } from "../shared/errors.js";
import { querySql } from "../shared/process.js";
import { knownToken, tickerSymbol, tokenSymbol } from "../shared/tokens.js";
import {
  cleanStoredScalar,
  formatTokenUnits,
  getArray,
  getRecord,
  parseStoredBigInt,
} from "../shared/utils.js";
import { loadWalletState, type WalletState } from "../wallet/store.js";
import {
  accessKeyMatches,
  isPaymentCapableStatus,
  selectPaymentCapableAccessKey,
  type LocalAccessKeyStatus,
} from "../wallet/access-key.js";
import {
  balanceQueryError,
  currentKeyOutput,
  keyTokens,
  readChainKey,
  rpcChainCheck,
  statusQueryTimeout,
  tokenBalance,
  tokenDetails,
  tokenKey,
  type TokenBalance,
} from "../wallet/key-output.js";
import { queryMachBalance } from "../shared/mach.js";
import { queryCreditBalance, warnCreditsDeprecated } from "./credits.js";

export default {
  command: Cli.create("whoami", {
    description: "Show who you are: wallet, balances, keys",
    globals: cliGlobals,
    options: whoamiOptions,
    alias: globalAlias,
    output: whoamiOutput,
    async run({ globals, options }) {
      return whoamiHandler({ ...options, network: globals.network });
    },
  }),
  annotations: { whoami: { ...readOnly, openWorldHint: true } },
  describe: {
    name: "whoami",
    about:
      "Show who you are: wallet, balances, keys (key.spending_limit is deprecated; use key.spending_limits)",
    args: [
      flag("mach", "--mach", "Show on-chain MACH balance"),
      flag("credits", "--credits", "Show existing MPP Credits balance (deprecated)"),
    ],
  },
} satisfies WalletCommand;

/** Whoami output when the active wallet already has a usable access key on `network`. */
export async function cachedLoginOutput(state: WalletState, network: Network) {
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  if (
    !activeAccount ||
    storedChainId(state) !== network.chainId ||
    !selectPaymentCapableAccessKey(state.accessKeys, {
      chainId: network.chainId,
      walletAddress: activeAccount.address,
    })
  )
    return undefined;
  return await currentWhoamiOutput({
    walletAddress: activeAccount.address,
    chain: network.chainId,
    accessKeys: state.accessKeys,
  });
}

export async function whoamiHandler(options: {
  network?: string | undefined;
  credits?: boolean | undefined;
  mach?: boolean | undefined;
}) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const walletAddress = activeAccount?.address ?? null;
  const network = await resolveNetwork(options.network, state);

  if (options.credits && options.mach) throw usageError("Use only one of --credits and --mach");
  if (options.credits) warnCreditsDeprecated();
  if (options.credits || options.mach) {
    if (!walletAddress)
      throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");
    if (options.credits) return { credits: await queryCreditBalance({ walletAddress }) };
    return { mach: await queryMachBalance({ chainId: network.chainId, walletAddress }) };
  }

  return await currentWhoamiOutput({
    walletAddress,
    chain: network.chainId,
    accessKeys: state.accessKeys,
  });
}

export async function currentWhoamiOutput(options: {
  walletAddress: string | null;
  chain: number;
  accessKeys: WalletState["accessKeys"];
}) {
  const paymentKey = options.walletAddress
    ? selectPaymentCapableAccessKey(options.accessKeys, {
        chainId: options.chain,
        walletAddress: options.walletAddress,
      })
    : undefined;
  const key =
    paymentKey ??
    (options.walletAddress
      ? options.accessKeys.find((candidate) =>
          accessKeyMatches(candidate, {
            chainId: options.chain,
            walletAddress: options.walletAddress!,
          }),
        )
      : undefined);
  const token = key?.limits?.[0]?.token ?? tokenAddress(options.chain);
  const [balance, assets, sessions, details, chainKey] = await Promise.all([
    tokenBalance({ chain: options.chain, token, walletAddress: options.walletAddress }),
    fetchWalletAssets({
      chain: options.chain,
      walletAddress: options.walletAddress,
    }),
    sessionStats({ token, walletAddress: options.walletAddress }),
    tokenDetails(key ? keyTokens(key) : [{ chain: options.chain, token, read: true }]),
    // `key` is always the logged-in wallet's.
    key ? readChainKey(key, rpcChainCheck()) : undefined,
  ]);
  const symbol = details.get(tokenKey(options.chain, token))?.symbol ?? null;
  const balances = walletBalances({
    accessKey: key,
    assets,
    fallback: balance,
    fallbackVerified: knownToken(token, options.chain) !== undefined,
    symbol,
  });
  const keyOutput = key ? currentKeyOutput(key, balance, details, chainKey) : null;
  return {
    ready: whoamiReady(options.walletAddress, keyOutput?.status, balance),
    wallet: options.walletAddress?.toLowerCase() ?? null,
    ...networkFields(options.chain),
    balance: {
      ...balanceOutput(balance, sessions, symbol),
      ...(options.walletAddress && !balance ? { error: balanceQueryError } : {}),
    },
    balances,
    key: keyOutput,
  };
}

/**
 * `whoami` is ready with a logged-in wallet, an access key on the network that can pay, and a
 * balance query that succeeded. It reads the status the key output reports, so the two always
 * agree; a `pending` key counts, since its authorization is published with its first payment.
 */
function whoamiReady(
  walletAddress: string | null,
  status: LocalAccessKeyStatus | undefined,
  balance: TokenBalance | null,
) {
  return Boolean(walletAddress && balance && status && isPaymentCapableStatus(status));
}

type WalletAsset = {
  address: string;
  balance: string;
  decimals: number;
  symbol: string | null;
  verified: boolean;
};

function walletBalances(options: {
  accessKey: WalletState["accessKeys"][number] | undefined;
  assets: WalletAsset[];
  fallback: TokenBalance | null;
  // Only a listed token is verified; an unlisted token's symbol is self-declared.
  fallbackVerified: boolean;
  symbol: string | null;
}) {
  const balances = options.assets.map((asset) => {
    const limit = options.accessKey?.limits?.find(
      (candidate) => candidate.token.toLowerCase() === asset.address.toLowerCase(),
    );
    return {
      token: asset.address.toLowerCase(),
      symbol: asset.symbol,
      decimals: asset.decimals,
      balance: formatUnits(BigInt(asset.balance), asset.decimals),
      verified: asset.verified,
      access_key_limit: formatAccessKeyLimit(limit?.limit, asset.decimals),
    };
  });

  if (
    options.fallback &&
    !balances.some(
      (balance) => balance.token.toLowerCase() === options.fallback?.token.toLowerCase(),
    )
  ) {
    const limit = options.accessKey?.limits?.find(
      (candidate) => candidate.token.toLowerCase() === options.fallback?.token.toLowerCase(),
    );
    balances.push({
      token: options.fallback.token.toLowerCase(),
      symbol: options.symbol,
      decimals: 6,
      balance: options.fallback.formatted,
      verified: options.fallbackVerified,
      access_key_limit: formatAccessKeyLimit(limit?.limit, 6),
    });
  }

  return balances;
}

async function fetchWalletAssets(options: {
  chain: number;
  walletAddress: string | null;
}): Promise<WalletAsset[]> {
  if (!options.walletAddress) return [];
  const url = new URL("/api/assets", appUrl);
  url.searchParams.set("address", options.walletAddress);
  url.searchParams.set("chainId", String(options.chain));
  url.searchParams.set("fresh", "true");

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(statusQueryTimeout) });
    if (!response.ok) return [];
    return getArray(await response.json()).flatMap((value) => {
      const asset = getRecord(value);
      if (
        typeof asset.address !== "string" ||
        !isAddress(asset.address) ||
        typeof asset.balance !== "string" ||
        !/^\d+$/.test(asset.balance) ||
        BigInt(asset.balance) === 0n ||
        typeof asset.decimals !== "number" ||
        !Number.isInteger(asset.decimals) ||
        asset.decimals < 0 ||
        asset.decimals > 77 ||
        typeof asset.symbol !== "string"
      )
        return [];
      return [
        {
          address: asset.address,
          balance: asset.balance,
          decimals: asset.decimals,
          symbol: tokenSymbol(asset.address, options.chain) ?? tickerSymbol(asset.symbol),
          verified: asset.verified === true,
        },
      ];
    });
  } catch {
    return [];
  }
}

function formatAccessKeyLimit(value: string | undefined, decimals: number) {
  if (!value) return null;
  try {
    return formatUnits(BigInt(cleanStoredScalar(value)), decimals);
  } catch {
    return null;
  }
}

type SessionStats = {
  active: number;
  locked: bigint;
  pendingRefund: bigint;
};

async function sessionStats(options: {
  token: string | undefined;
  walletAddress: string | null;
}): Promise<SessionStats> {
  if (!options.walletAddress) return { active: 0, locked: 0n, pendingRefund: 0n };
  const token = options.token?.toLowerCase();
  const query = `SELECT token, deposit, cumulative_amount, accepted_cumulative, server_spent, state, close_requested_at
             FROM channels
             WHERE LOWER(payer) = LOWER('${options.walletAddress.replaceAll("'", "''")}')
               AND state IN ('active', 'closing', 'finalizable')`;
  try {
    const rows = getArray(await querySql(query));
    let active = 0;
    let locked = 0n;
    let pendingRefund = 0n;
    for (const row of rows) {
      const item = getRecord(row);
      if (token && String(item.token).toLowerCase() !== token) continue;
      const spent = maxBigInt(
        parseStoredBigInt(item.cumulative_amount),
        parseStoredBigInt(item.accepted_cumulative),
        parseStoredBigInt(item.server_spent),
      );
      const deposit = parseStoredBigInt(item.deposit);
      const remaining = deposit > spent ? deposit - spent : 0n;
      if (item.state === "active" && Number(item.close_requested_at) === 0) {
        active += 1;
        locked += remaining;
      } else {
        pendingRefund += remaining;
      }
    }
    return { active, locked, pendingRefund };
  } catch {
    return { active: 0, locked: 0n, pendingRefund: 0n };
  }
}

function balanceOutput(
  balance: TokenBalance | null,
  sessions: SessionStats,
  symbol: string | null,
) {
  const total = balance ? balance.raw + sessions.locked + sessions.pendingRefund : null;
  return {
    total: total === null ? null : formatTokenUnits(total, 6),
    locked: formatTokenUnits(sessions.locked, 6),
    pending_refund: formatTokenUnits(sessions.pendingRefund, 6),
    available: balance?.formatted ?? null,
    active_sessions: sessions.active,
    symbol,
  };
}

function maxBigInt(...values: bigint[]) {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}
