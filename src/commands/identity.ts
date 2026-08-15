import { arch, platform } from "node:process";
import type { Provider as CoreProvider } from "accounts";
import { erc20Abi, formatUnits, isAddress, parseUnits, toHex, type Address } from "viem";
import { Actions } from "viem/tempo";

import { version } from "../shared/constants.js";
import {
  chainId,
  createTempoPublicClient,
  networkName,
  tokenAddress,
  tokenDecimals,
  tokenSymbol,
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
  type AccessKeyScope,
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
import { queryCreditBalance } from "./credits.js";

export async function loginHandler(options: {
  network?: string | undefined;
  browser?: boolean | undefined;
}) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  if (activeAccount && walletStateMatchesNetwork(state, options.network))
    return await currentWhoamiOutput({
      walletAddress: activeAccount.address,
      chain: state.chainId ?? null,
      accessKeys: state.accessKeys,
      network: options.network,
    });

  const provider = createProvider({
    network: options.network,
    noBrowser: options.browser === false,
  });
  const result = await connect(provider);

  return {
    accounts: result.accounts.map((account) => account.address),
    chainId: chainId(options.network),
  };
}

export async function refreshHandler(options: { network?: string | undefined }) {
  console.error(`Auth URL: ${refreshAuthUrl(options.network)}`);
  const provider = createProvider({ network: options.network });
  const result = await connect(provider);

  return {
    accounts: result.accounts.map((account) => account.address),
    chainId: chainId(options.network),
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
}) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const walletAddress = activeAccount?.address ?? null;
  const chain = state.chainId ?? null;

  if (!options.credits && !walletStateMatchesNetwork(state, options.network))
    return { ready: false };

  if (options.credits && !walletAddress)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");

  const credits =
    options.credits && walletAddress
      ? await queryCreditBalance({ chainId: chain, walletAddress })
      : null;

  if (options.credits) return { credits };

  return await currentWhoamiOutput({
    walletAddress,
    chain,
    accessKeys: state.accessKeys,
    network: options.network,
  });
}

export async function keysHandler() {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const chain = state.chainId ?? null;

  return await currentKeysOutput({
    walletAddress: activeAccount?.address ?? null,
    chain,
    accessKeys: state.accessKeys,
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
    network?: string | undefined;
    noBrowser?: boolean | undefined;
  }) => UpdateAccessKeyProvider = createProvider,
  updateAccessKey: AccessKeyUpdater = updateAccessKeyThroughWallet,
) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  if (!activeAccount)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");
  if (!walletStateMatchesNetwork(state, options.network))
    throw usageError(
      "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
    );

  const selectedChainId = state.chainId ?? chainId(options.network);
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

  const token = options.token ?? key.limits[0]?.token ?? tokenAddress(selectedChainId);
  if (!isAddress(token)) throw usageError("Invalid token address: expected a 0x address");
  const limit = parseLimit(options.limit);
  const walletAddress = activeAccount.address as Address;
  const accessKeyAddress = key.address as Address;
  const tokenAddress_resolved = token as Address;
  const provider = createUpdateProvider({
    network: selectedChainId === 42431 ? "testnet" : undefined,
    noBrowser: options.browser === false,
  });

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
    const existing = candidate.limits.findIndex(
      (item) => item.token.toLowerCase() === tokenAddress_resolved.toLowerCase(),
    );
    const nextLimit = `${limit}#__bigint`;
    const limits =
      existing === -1
        ? [...candidate.limits, { token: tokenAddress_resolved, limit: nextLimit }]
        : candidate.limits.map((item, index) =>
            index === existing ? { ...item, limit: nextLimit } : item,
          );
    return { ...candidate, limits };
  });
  await saveWalletState({ ...state, accessKeys });

  return {
    status: "success" as const,
    wallet: walletAddress.toLowerCase(),
    access_key: accessKeyAddress.toLowerCase(),
    chain_id: selectedChainId,
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
  try {
    const limit = parseUnits(value, tokenDecimals());
    if (limit < 0n) throw new Error("negative limit");
    return limit;
  } catch {
    throw usageError("Invalid limit: expected a non-negative token amount");
  }
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
  createRevokeProvider: (options: {
    network?: string | undefined;
  }) => RevokeProvider = createProvider,
  revokeAccessKey: AccessKeyRevoker = revokeAccessKeyOnChain,
) {
  if (!isAddress(args.accessKey))
    throw usageError("Invalid access key address: expected a 0x address");

  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  if (!activeAccount)
    throw usageError("Configuration missing: No wallet configured. Run 'tempo wallet login'.");
  if (!walletStateMatchesNetwork(state, options.network))
    throw usageError(
      "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
    );

  const accessKeyAddress = args.accessKey as Address;
  const walletAddress = activeAccount.address as Address;
  const selectedChainId = state.chainId ?? chainId(options.network);
  const output = {
    access_key: accessKeyAddress.toLowerCase(),
    wallet: walletAddress.toLowerCase(),
  };

  if (options["dry-run"])
    return {
      ...output,
      status: "dry_run" as const,
      local_key_removed: false,
    };

  const provider = createRevokeProvider({ network: options.network });
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
  const chain = chainId(options.network);

  return {
    wallet_version: `${version} (local)`,
    request_version: `${version} (local)`,
    os: debugOs(),
    arch: debugArch(),
    network: networkName(chain) ?? "tempo",
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
  chain: number | null;
  accessKeys: WalletState["accessKeys"];
  network?: string | undefined;
}) {
  const selectedChain = options.chain ?? chainId(options.network);
  const paymentKey = options.walletAddress
    ? selectPaymentCapableAccessKey(options.accessKeys, {
        chainId: selectedChain,
        walletAddress: options.walletAddress,
      })
    : undefined;
  const key =
    paymentKey ??
    (options.walletAddress
      ? options.accessKeys.find((candidate) =>
          accessKeyMatches(candidate, {
            chainId: selectedChain,
            walletAddress: options.walletAddress!,
          }),
        )
      : undefined);
  const token = key?.limits[0]?.token ?? tokenAddress(selectedChain);
  const balance = await tokenBalance({
    token,
    walletAddress: options.walletAddress,
    network: options.network,
  });
  const sessions = await activeSessionStats({
    token: balance?.token ?? token,
    walletAddress: options.walletAddress,
  });
  return {
    ready: Boolean(options.walletAddress && paymentKey),
    wallet: options.walletAddress?.toLowerCase() ?? null,
    balance: balanceOutput(balance, sessions, tokenSymbol(token)),
    key: currentKeyOutput({
      key,
      walletAddress: options.walletAddress,
      chain: options.chain,
      balance,
      status: key ? localAccessKeyStatus(key) : null,
    }),
  };
}

export async function currentKeysOutput(options: {
  walletAddress: string | null;
  chain: number | null;
  accessKeys: WalletState["accessKeys"];
}) {
  const balances = new Map<string, TokenBalance | null>();
  const keys = [];
  for (const key of options.accessKeys) {
    const token = key.limits[0]?.token ?? tokenAddress(key.chainId);
    const balance = balances.has(token.toLowerCase())
      ? (balances.get(token.toLowerCase()) ?? null)
      : await tokenBalance({
          token,
          walletAddress: options.walletAddress,
          network: networkName(options.chain) === "tempo-moderato" ? "testnet" : undefined,
        });
    balances.set(token.toLowerCase(), balance);
    const output = currentKeyOutput({
      key,
      walletAddress: options.walletAddress,
      chain: options.chain,
      balance,
      status: localAccessKeyStatus(key),
    });
    if (output) keys.push(output);
  }

  return {
    keys,
    total: keys.length,
  };
}

function currentKeyOutput(options: {
  key: WalletState["accessKeys"][number] | undefined;
  walletAddress: string | null;
  chain: number | null;
  balance: TokenBalance | null;
  status: string | null;
}) {
  if (!options.key) return null;
  const limit = options.key.limits[0];
  const token = limit?.token ?? tokenAddress(options.chain ?? options.key.chainId);
  const spendingLimits = accessKeyLimitsOutput(options.key);
  return {
    address: options.key.address.toLowerCase(),
    chain_id: options.key.chainId,
    network: networkName(options.chain) ?? networkName(options.key.chainId) ?? "tempo",
    wallet_address: options.walletAddress?.toLowerCase() ?? null,
    symbol: tokenSymbol(token),
    token: token.toLowerCase(),
    balance:
      options.balance && options.balance.token.toLowerCase() === token.toLowerCase()
        ? options.balance.formatted
        : "0.000000",
    spending_limit: {
      unlimited: false,
      limit: limit ? formatMicroUnits(cleanStoredScalar(limit.limit)) : "0.000000",
      period_seconds: limit?.period ?? null,
      remaining: null,
      spent: null,
    },
    spending_limits: spendingLimits,
    scopes: accessKeyScopesOutput(options.key),
    status: options.status,
    expires_at: formatUnixTimestamp(options.key.expiry),
  };
}

function accessKeyLimitsOutput(key: WalletState["accessKeys"][number]) {
  return key.limits.map((limit) => ({
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
  return accessKeyScopes(key).map((scope) => ({
    address: scope.address.toLowerCase(),
    selector: scope.selector ?? null,
    recipients: scope.recipients.map((recipient) => recipient.toLowerCase()),
  }));
}

function accessKeyScopes(key: WalletState["accessKeys"][number]) {
  if (key.scopes !== undefined) return key.scopes;
  return parseKeyAuthorizationScopes(key.keyAuthorization);
}

function parseKeyAuthorizationScopes(value: unknown): readonly AccessKeyScope[] {
  const scopes = getArray(getRecord(value).scopes).flatMap((scope) => {
    const item = getRecord(scope);
    if (typeof item.address !== "string") return [];
    return [
      {
        address: item.address,
        selector: typeof item.selector === "string" ? item.selector : undefined,
        recipients: getArray(item.recipients).flatMap((recipient) =>
          typeof recipient === "string" ? [recipient] : [],
        ),
      },
    ];
  });
  return scopes;
}

type TokenBalance = {
  formatted: string;
  raw: bigint;
  symbol: string;
  token: string;
};

type SessionStats = {
  active: number;
  locked: bigint;
};

async function tokenBalance(options: {
  token: string | undefined;
  walletAddress: string | null;
  network?: string | undefined;
}): Promise<TokenBalance | null> {
  if (!options.walletAddress) return null;
  const token = options.token ?? tokenAddress(chainId(options.network));
  try {
    const client = createTempoPublicClient(options.network);
    const raw = await client.readContract({
      address: token as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [options.walletAddress as Address],
    });
    return {
      formatted: formatUnits(raw, 6),
      raw,
      symbol: tokenSymbol(token),
      token,
    };
  } catch {
    return null;
  }
}

async function activeSessionStats(options: {
  token: string | undefined;
  walletAddress: string | null;
}): Promise<SessionStats> {
  if (!options.walletAddress) return { active: 0, locked: 0n };
  const token = options.token?.toLowerCase();
  const query = `SELECT token, deposit, cumulative_amount, accepted_cumulative, server_spent
             FROM channels
             WHERE LOWER(payer) = LOWER('${options.walletAddress.replaceAll("'", "''")}')
               AND state = 'active'
               AND close_requested_at = 0`;
  try {
    const stdout = await runProcess("sqlite3", ["-json", channelsDbPath(), query]);
    const rows = getArray(JSON.parse(stdout || "[]") as unknown);
    let active = 0;
    let locked = 0n;
    for (const row of rows) {
      const item = getRecord(row);
      if (token && String(item.token).toLowerCase() !== token) continue;
      const spent = maxBigInt(
        parseStoredBigInt(item.cumulative_amount),
        parseStoredBigInt(item.accepted_cumulative),
        parseStoredBigInt(item.server_spent),
      );
      const deposit = parseStoredBigInt(item.deposit);
      active += 1;
      locked += deposit > spent ? deposit - spent : 0n;
    }
    return { active, locked };
  } catch {
    return { active: 0, locked: 0n };
  }
}

function balanceOutput(
  balance: TokenBalance | null,
  sessions: SessionStats,
  fallbackSymbol: string,
) {
  const available = balance?.raw ?? 0n;
  const total = available + sessions.locked;
  return {
    total: formatTokenUnits(total, 6),
    locked: formatTokenUnits(sessions.locked, 6),
    available: balance?.formatted ?? "0.000000",
    active_sessions: sessions.active,
    symbol: balance?.symbol ?? fallbackSymbol,
  };
}

function maxBigInt(...values: bigint[]) {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}

function refreshAuthUrl(network: string | undefined) {
  const chain = chainId(network);
  const url = new URL("https://wallet.tempo.xyz/cli-auth");
  url.searchParams.set("network", network === "testnet" ? "testnet" : "mainnet");
  url.searchParams.set("chainId", `0x${chain.toString(16)}`);
  url.searchParams.set("code", Math.random().toString(36).slice(2, 10).toUpperCase());
  return url.toString();
}

function debugOs() {
  if (platform === "darwin") return "macos";
  return platform;
}

function debugArch() {
  if (arch === "arm64") return "aarch64";
  return arch;
}

function walletStateMatchesNetwork(state: WalletState, network: string | undefined) {
  if (!network) return true;
  const selectedChainId = chainId(network);
  return state.chainId === selectedChainId;
}
