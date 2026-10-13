import { arch, platform } from "node:process";
import type { Provider as CoreProvider } from "accounts";
import { erc20Abi, formatUnits, isAddress, parseUnits, toHex, type Address } from "viem";
import { Actions } from "viem/tempo";

import { version } from "../shared/constants.js";
import {
  appUrl,
  createTempoPublicClient,
  explicitNetwork,
  networkFields,
  resolveNetwork,
  storedChainId,
  tokenAddress,
  tokenDecimals,
  tokenSymbol,
  type Network,
} from "../shared/network.js";
import { usageError } from "../shared/errors.js";
import { channelsDbPath, runProcess } from "../shared/process.js";
import {
  cleanStoredScalar,
  formatMicroUnits,
  formatTokenUnits,
  formatUnixTimestamp,
  getArray,
  getRecord,
  parseStoredBigInt,
} from "../shared/utils.js";
import { connect, createProvider } from "../provider.js";
import {
  emptyWalletState,
  loadWalletState,
  saveWalletState,
  type WalletState,
} from "../wallet/store.js";
import {
  accessKeyMatches,
  localAccessKeyStatus,
  selectPaymentCapableAccessKey,
} from "../wallet/access-key.js";
import { queryMachBalance } from "../shared/mach.js";
import { queryCreditBalance, warnCreditsDeprecated } from "./credits.js";

export async function loginHandler(options: {
  network?: string | undefined;
  browser?: boolean | undefined;
}) {
  const network = await resolveNetwork(options.network);
  const cached = await cachedLoginOutput(network);
  if (cached) return cached;

  const provider = createProvider({ network, noBrowser: options.browser === false });
  const result = await connect(provider, network);

  return {
    accounts: result.accounts.map((account) => account.address),
    chainId: network.chainId,
  };
}

/** Whoami output when the active wallet already has a usable access key on `network`. */
export async function cachedLoginOutput(network: Network) {
  const state = await loadWalletState();
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

export async function refreshHandler(options: { network?: string | undefined }) {
  const network = await resolveNetwork(options.network);
  const result = await connect(createProvider({ network }), network);

  return {
    accounts: result.accounts.map((account) => account.address),
    chainId: network.chainId,
  };
}

export async function logoutHandler() {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  await saveWalletState(emptyWalletState());
  return {
    logged_in: Boolean(activeAccount),
    disconnected: Boolean(activeAccount),
    wallet: activeAccount?.address.toLowerCase() ?? null,
    message: activeAccount ? "wallet disconnected" : "not logged in",
  };
}

export async function whoamiHandler(options: {
  network?: string | undefined;
  credits?: boolean | undefined;
  mach?: boolean | undefined;
}) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const walletAddress = activeAccount?.address ?? null;
  const network = await resolveNetwork(options.network);

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

/** Lists keys on every network unless `--network` or `TEMPO_WALLET_NETWORK` selects one. */
export async function keysHandler(options: { network?: string | undefined } = {}) {
  const state = await loadWalletState();
  const network = explicitNetwork(options.network);

  return await currentKeysOutput({
    accessKeys: network
      ? state.accessKeys.filter((key) => key.chainId === network.chainId)
      : state.accessKeys,
  });
}

type UpdateAccessKeyProvider = Pick<CoreProvider.Provider, "request">;

type AccessKeyUpdater = (options: {
  provider: UpdateAccessKeyProvider;
  walletAddress: Address;
  accessKeyAddress: Address;
  chainId: number;
  token: Address;
  limit: bigint;
}) => Promise<unknown>;

export async function updateAccessKeyHandler(
  options: {
    network?: string | undefined;
    accessKey?: string | undefined;
    limit: string;
    token?: string | undefined;
    browser?: boolean | undefined;
  },
  createUpdateProvider: (options: {
    network: Network;
    noBrowser?: boolean | undefined;
  }) => UpdateAccessKeyProvider = createProvider,
  updateAccessKey: AccessKeyUpdater = updateAccessKeyThroughWallet,
) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  if (!activeAccount)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");
  const network = await walletNetwork(state, options.network);

  const selectedChainId = network.chainId;
  if (options.accessKey !== undefined && !isAddress(options.accessKey))
    throw usageError("Invalid access key address: expected a 0x address");
  const key = state.accessKeys.find(
    (candidate) =>
      candidate.access.toLowerCase() === activeAccount.address.toLowerCase() &&
      candidate.chainId === selectedChainId &&
      (options.accessKey === undefined ||
        candidate.address.toLowerCase() === options.accessKey.toLowerCase()),
  );
  if (!key && options.accessKey !== undefined)
    throw usageError("Selected access key is not configured for the current wallet and network.");
  if (!key)
    throw usageError(
      "No access key configured for the current wallet and network. Run 'tempo wallet login'.",
    );

  const token = options.token ?? key.limits?.[0]?.token ?? tokenAddress(selectedChainId);
  if (!isAddress(token)) throw usageError("Invalid token address: expected a 0x address");
  const limit = parseLimit(options.limit);
  const walletAddress = activeAccount.address as Address;
  const accessKeyAddress = key.address as Address;
  const tokenAddress_resolved = token as Address;
  const provider = createUpdateProvider({ network, noBrowser: options.browser === false });

  await updateAccessKey({
    provider,
    walletAddress,
    accessKeyAddress,
    chainId: selectedChainId,
    token: tokenAddress_resolved,
    limit,
  });

  const accessKeys = state.accessKeys.map((candidate) => {
    if (candidate !== key) return candidate;
    const storedLimits = candidate.limits ?? [];
    const existing = storedLimits.findIndex(
      (item) => item.token.toLowerCase() === tokenAddress_resolved.toLowerCase(),
    );
    const nextLimit = `${limit}#__bigint`;
    const limits =
      existing === -1
        ? [...storedLimits, { token: tokenAddress_resolved, limit: nextLimit }]
        : storedLimits.map((item, index) =>
            index === existing ? { ...item, limit: nextLimit } : item,
          );
    return { ...candidate, limits };
  });
  await saveWalletState({ ...state, accessKeys });

  return {
    status: "success" as const,
    wallet: walletAddress.toLowerCase(),
    access_key: accessKeyAddress.toLowerCase(),
    ...networkFields(selectedChainId),
    token: tokenAddress_resolved.toLowerCase(),
    limit: formatUnits(limit, tokenDecimals()),
  };
}

async function updateAccessKeyThroughWallet(options: {
  provider: UpdateAccessKeyProvider;
  walletAddress: Address;
  accessKeyAddress: Address;
  chainId: number;
  token: Address;
  limit: bigint;
}) {
  await options.provider.request({
    method: "wallet_updateAccessKey",
    params: [
      {
        address: options.walletAddress,
        accessKeyAddress: options.accessKeyAddress,
        chainId: toHex(options.chainId),
        limits: [{ token: options.token, limit: toHex(options.limit) }],
      },
    ],
  });
}

function parseLimit(value: string) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value))
    throw usageError("Invalid limit: expected a non-negative token amount");
  return parseUnits(value, tokenDecimals());
}

type RevokeProvider = Pick<CoreProvider.Provider, "getAccount" | "getClient">;

type AccessKeyRevoker = (options: {
  provider: RevokeProvider;
  walletAddress: Address;
  accessKeyAddress: Address;
  chainId: number;
}) => Promise<unknown>;

export async function revokeHandler(
  args: { accessKey: string },
  options: { network?: string | undefined; "dry-run"?: boolean | undefined },
  createRevokeProvider: (options: { network: Network }) => RevokeProvider = createProvider,
  revokeAccessKey: AccessKeyRevoker = revokeAccessKeyOnChain,
) {
  if (!isAddress(args.accessKey))
    throw usageError("Invalid access key address: expected a 0x address");

  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  if (!activeAccount)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");
  const network = await walletNetwork(state, options.network);

  const accessKeyAddress = args.accessKey as Address;
  const walletAddress = activeAccount.address as Address;
  const selectedChainId = network.chainId;
  const output = {
    access_key: accessKeyAddress.toLowerCase(),
    wallet: walletAddress.toLowerCase(),
    ...networkFields(selectedChainId),
  };

  if (options["dry-run"])
    return {
      ...output,
      status: "dry_run" as const,
      local_key_removed: false,
    };

  const provider = createRevokeProvider({ network });
  await revokeAccessKey({
    provider,
    walletAddress,
    accessKeyAddress,
    chainId: selectedChainId,
  });

  const accessKeys = state.accessKeys.filter(
    (key) =>
      !localKeyMatchesRevoke({
        key,
        accessKeyAddress,
        walletAddress,
        chainId: selectedChainId,
      }),
  );
  const localKeyRemoved = accessKeys.length !== state.accessKeys.length;
  if (localKeyRemoved) await saveWalletState({ ...state, accessKeys });

  return {
    ...output,
    status: "success" as const,
    local_key_removed: localKeyRemoved,
  };
}

async function revokeAccessKeyOnChain(options: {
  provider: RevokeProvider;
  walletAddress: Address;
  accessKeyAddress: Address;
  chainId: number;
}) {
  const account = options.provider.getAccount({
    address: options.walletAddress,
    signable: true,
  });
  const client = options.provider.getClient({ chainId: options.chainId });
  await Actions.accessKey.revoke(client, {
    account,
    accessKey: options.accessKeyAddress,
    chain: client.chain,
  });
}

function localKeyMatchesRevoke(options: {
  key: WalletState["accessKeys"][number];
  accessKeyAddress: Address;
  walletAddress: Address;
  chainId: number;
}) {
  return (
    options.key.address.toLowerCase() === options.accessKeyAddress.toLowerCase() &&
    options.key.access.toLowerCase() === options.walletAddress.toLowerCase() &&
    options.key.chainId === options.chainId
  );
}

export async function debugHandler(options: { network?: string | undefined }) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const network = await resolveNetwork(options.network);

  return {
    wallet_version: `${version} (local)`,
    request_version: `${version} (local)`,
    os: debugOs(),
    arch: debugArch(),
    ...networkFields(network.chainId),
    wallet: activeAccount?.address.toLowerCase() ?? null,
    wallet_type: activeAccount ? "passkey" : "unknown",
    logged_in: Boolean(activeAccount),
  };
}

export function completionsHandler() {
  return {
    supported_shells: ["bash", "zsh", "fish", "powershell", "elvish"],
  };
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
  const [balance, assets, sessions] = await Promise.all([
    tokenBalance({ chain: options.chain, token, walletAddress: options.walletAddress }),
    fetchWalletAssets({
      chain: options.chain,
      walletAddress: options.walletAddress,
    }),
    sessionStats({ token, walletAddress: options.walletAddress }),
  ]);
  const balances = walletBalances({
    accessKey: key,
    assets,
    fallback: balance,
  });
  return {
    ready: Boolean(options.walletAddress && paymentKey && balance),
    wallet: options.walletAddress?.toLowerCase() ?? null,
    ...networkFields(options.chain),
    balance: {
      ...balanceOutput(balance, sessions, tokenSymbol(token)),
      ...(options.walletAddress && !balance ? { error: balanceQueryError } : {}),
    },
    balances,
    key: key ? currentKeyOutput(key, balance) : null,
  };
}

/** Labels each key, and queries its balance, from the key's own chain and wallet. */
export async function currentKeysOutput(options: { accessKeys: WalletState["accessKeys"] }) {
  const balances = new Map<string, TokenBalance | null>();
  const keys = [];
  for (const key of options.accessKeys) {
    const token = key.limits?.[0]?.token ?? tokenAddress(key.chainId);
    const balanceKey = `${key.chainId}:${key.access}:${token}`.toLowerCase();
    const balance = balances.has(balanceKey)
      ? (balances.get(balanceKey) ?? null)
      : await tokenBalance({ chain: key.chainId, token, walletAddress: key.access });
    balances.set(balanceKey, balance);
    keys.push(currentKeyOutput(key, balance));
  }

  return {
    keys,
    total: keys.length,
  };
}

function currentKeyOutput(key: WalletState["accessKeys"][number], balance: TokenBalance | null) {
  const limit = key.limits?.[0];
  const spendingMode = permissionMode(key.limits, key.permissionSemantics);
  const callMode = permissionMode(key.scopes, key.permissionSemantics);
  const token = limit?.token ?? tokenAddress(key.chainId);
  const spendingLimits = accessKeyLimitsOutput(key);
  return {
    address: key.address.toLowerCase(),
    ...networkFields(key.chainId),
    wallet_address: key.access.toLowerCase(),
    symbol: tokenSymbol(token),
    token: token.toLowerCase(),
    balance:
      balance && balance.token.toLowerCase() === token.toLowerCase() ? balance.formatted : null,
    ...(!balance ? { balance_error: balanceQueryError } : {}),
    spending_limit: {
      mode: spendingMode,
      unlimited: spendingMode === "unknown" ? null : spendingMode === "unrestricted",
      limit:
        spendingMode === "none"
          ? "0.000000"
          : spendingMode === "restricted" && limit
            ? formatMicroUnits(cleanStoredScalar(limit.limit))
            : null,
      period_seconds: limit?.period ?? null,
      remaining: null,
      spent: null,
    },
    spending_limits: spendingLimits,
    call_permissions: callMode,
    scopes: accessKeyScopesOutput(key),
    status: localAccessKeyStatus(key),
    expires_at: formatUnixTimestamp(key.expiry),
  };
}

function accessKeyLimitsOutput(key: WalletState["accessKeys"][number]) {
  return (key.limits ?? []).map((limit) => ({
    unlimited: false,
    symbol: tokenSymbol(limit.token),
    token: limit.token.toLowerCase(),
    limit: formatMicroUnits(cleanStoredScalar(limit.limit)),
    period_seconds: limit.period ?? null,
    remaining: null,
    spent: null,
  }));
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

type TokenBalance = {
  formatted: string;
  raw: bigint;
  symbol: string;
  token: string;
};

type WalletAsset = {
  address: string;
  balance: string;
  decimals: number;
  symbol: string;
  verified: boolean;
};

function walletBalances(options: {
  accessKey: WalletState["accessKeys"][number] | undefined;
  assets: WalletAsset[];
  fallback: TokenBalance | null;
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
      symbol: options.fallback.symbol,
      decimals: 6,
      balance: options.fallback.formatted,
      verified: true,
      access_key_limit: formatAccessKeyLimit(limit?.limit, 6),
    });
  }

  return balances;
}

// Status queries should return promptly even when an upstream service stalls.
const statusQueryTimeout = 3_000;

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
          symbol: asset.symbol,
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

const balanceQueryError = {
  code: "E_RPC" as const,
  message: "Unable to query token balance. Check RPC connectivity and TEMPO_RPC_URL.",
};

type SessionStats = {
  active: number;
  locked: bigint;
  pendingRefund: bigint;
};

async function tokenBalance(options: {
  chain: number;
  token: string;
  walletAddress: string | null;
}): Promise<TokenBalance | null> {
  if (!options.walletAddress) return null;
  try {
    const client = createTempoPublicClient(options.chain, {
      timeout: statusQueryTimeout,
      retryCount: 0,
    });
    const raw = await client.readContract({
      address: options.token as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [options.walletAddress as Address],
    });
    return {
      formatted: formatUnits(raw, 6),
      raw,
      symbol: tokenSymbol(options.token),
      token: options.token,
    };
  } catch {
    return null;
  }
}

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
    const stdout = await runProcess("sqlite3", ["-json", channelsDbPath(), query]);
    const rows = getArray(JSON.parse(stdout || "[]") as unknown);
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
  fallbackSymbol: string,
) {
  const total = balance ? balance.raw + sessions.locked + sessions.pendingRefund : null;
  return {
    total: total === null ? null : formatTokenUnits(total, 6),
    locked: formatTokenUnits(sessions.locked, 6),
    pending_refund: formatTokenUnits(sessions.pendingRefund, 6),
    available: balance?.formatted ?? null,
    active_sessions: sessions.active,
    symbol: balance?.symbol ?? fallbackSymbol,
  };
}

function maxBigInt(...values: bigint[]) {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}

function debugOs() {
  if (platform === "darwin") return "macos";
  return platform;
}

function debugArch() {
  if (arch === "arm64") return "aarch64";
  return arch;
}

/** Key management signs through the wallet session, so it must target the logged-in chain. */
async function walletNetwork(state: WalletState, flag: string | undefined) {
  const network = await resolveNetwork(flag);
  if (storedChainId(state) !== network.chainId)
    throw usageError(
      "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
    );
  return network;
}
