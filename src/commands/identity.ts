import { arch, platform } from "node:process";
import { Rpc, type Provider as CoreProvider } from "accounts";
import { z } from "incur";
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
  type Network,
} from "../shared/network.js";
import { errorCodes, networkError, usageError } from "../shared/errors.js";
import { continuationCommand, nextStep } from "../shared/next.js";
import type { Wallet } from "../shared/require-wallet.js";
import { channelsDbPath, confirm as confirmPrompt, runProcess } from "../shared/process.js";
import {
  knownToken,
  readTokenMetadata,
  resolveTokenAddress,
  tickerSymbol,
  tokenMetadata,
  tokenSymbol,
} from "../shared/tokens.js";
import {
  cleanStoredScalar,
  formatTokenUnits,
  formatUnixTimestamp,
  getArray,
  getRecord,
  parseStoredBigInt,
} from "../shared/utils.js";
import { supportedShells } from "../completions.js";
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

/**
 * Authorizes a new access key. The stored keys stay in place, so the current one remains usable
 * until the wallet app approves the new one.
 */
export async function refreshHandler(
  options: { network?: string | undefined; browser?: boolean | undefined },
  createRefreshProvider: (options: {
    network: Network;
    noBrowser?: boolean | undefined;
  }) => Pick<CoreProvider.Provider, "request"> = createProvider,
) {
  const network = await resolveNetwork(options.network);
  const result = await connect(
    createRefreshProvider({ network, noBrowser: options.browser === false }),
    network,
  );

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

/** Lists keys on every network unless `--network` or `TEMPO_WALLET_NETWORK` selects one. */
export async function keysHandler(options: { network?: string | undefined } = {}) {
  const state = await loadWalletState();
  const network = explicitNetwork(options.network);

  return await currentKeysOutput({
    walletAddress: state.accounts[state.activeAccount ?? 0]?.address ?? null,
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
  wallet: Wallet,
  options: {
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
  const { account, network, state } = wallet;
  requireWalletChain(wallet);

  const selectedChainId = network.chainId;
  const selected = options.accessKey;
  if (selected !== undefined && !isAddress(selected))
    throw usageError("Invalid access key address: expected a 0x address");
  // Expired and unusable keys count: the wallet app approves the update, not the local key.
  const stored = state.accessKeys.filter((candidate) =>
    accessKeyMatches(candidate, { chainId: selectedChainId, walletAddress: account.address }),
  );
  if (selected === undefined && stored.length > 1)
    throw usageError(
      `More than one access key is configured for the current wallet and network (${stored
        .map((candidate) => candidate.address.toLowerCase())
        .join(", ")}); pass the access key to update.`,
    );
  const key =
    selected === undefined
      ? stored[0]
      : stored.find((candidate) => candidate.address.toLowerCase() === selected.toLowerCase());
  if (!key)
    throw usageError(
      selected === undefined
        ? "No access key is configured for the current wallet and network."
        : "Selected access key is not configured for the current wallet and network.",
    );

  const { address: token, decimals } = await tokenMetadata(
    resolveTokenAddress(
      options.token ?? key.limits?.[0]?.token ?? tokenAddress(selectedChainId),
      network,
    ),
    selectedChainId,
  );
  const limit = parseLimit(options.limit, decimals);
  const walletAddress = account.address as Address;
  const accessKeyAddress = key.address as Address;
  const provider = createUpdateProvider({ network, noBrowser: options.browser === false });

  await updateAccessKey({
    provider,
    walletAddress,
    accessKeyAddress,
    chainId: selectedChainId,
    token,
    limit,
  });

  const accessKeys = state.accessKeys.map((candidate) => {
    if (candidate !== key) return candidate;
    const storedLimits = candidate.limits ?? [];
    const existing = storedLimits.findIndex((item) => item.token.toLowerCase() === token);
    const nextLimit = `${limit}#__bigint`;
    const limits =
      existing === -1
        ? [...storedLimits, { token, limit: nextLimit }]
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
    token,
    limit: formatUnits(limit, decimals),
    ...nextStep("Run the next command to confirm the new limit.", ["wallet", "keys", "list"], {
      network,
    }),
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

/** Parses a limit in the token's decimals; zero is allowed and leaves the key unable to spend it. */
function parseLimit(value: string, decimals: number) {
  const fraction = value.split(".")[1] ?? "";
  if (!/^\d+(?:\.\d+)?$/.test(value) || fraction.length > decimals)
    throw usageError(
      `Invalid limit: expected a non-negative token amount with at most ${decimals} decimals`,
    );
  return parseUnits(value, decimals);
}

type RevokeProvider = Pick<CoreProvider.Provider, "request">;

/** What `revoke` uses of incur's run context; `error` keeps the `cta` that thrown errors lose. */
type RevokeContext = {
  agent: boolean;
  error: (error: {
    code: "E_USAGE";
    message: string;
    exitCode: number;
    retryable: boolean;
    cta: { commands: { command: string }[] };
  }) => never;
};

/** An access key's state in the AccountKeychain precompile, where revocation takes effect. */
type OnChainKey = { status: "published" | "revoked" | "missing"; expiry: number | undefined };

type OnChainKeyReader = (options: {
  chainId: number;
  walletAddress: Address;
  accessKeyAddress: Address;
}) => Promise<OnChainKey>;

/**
 * Revokes an access key of the logged-in wallet on its network through the wallet app, after
 * confirmation: a prompt on interactive runs, `--yes` on agent runs. The key must be stored for
 * the wallet or, when created elsewhere, authorized for it on-chain. The command succeeds only
 * once the chain shows the key revoked.
 */
export async function revokeHandler(
  wallet: Wallet,
  args: { accessKey: string },
  options: {
    browser?: boolean | undefined;
    "dry-run"?: boolean | undefined;
    yes?: boolean | undefined;
  },
  context: RevokeContext,
  dependencies: {
    confirm?: (question: string) => Promise<boolean>;
    createProvider?: (options: {
      network: Network;
      noBrowser?: boolean | undefined;
    }) => RevokeProvider;
    readKey?: OnChainKeyReader;
  } = {},
) {
  if (!isAddress(args.accessKey))
    throw usageError("Invalid access key address: expected a 0x address");

  const { account, network, state } = wallet;
  requireWalletChain(wallet);

  const accessKeyAddress = args.accessKey as Address;
  const walletAddress = account.address as Address;
  const selectedChainId = network.chainId;
  const readKey = dependencies.readKey ?? readAccessKeyOnChain;
  const target = { chainId: selectedChainId, walletAddress, accessKeyAddress };
  const output = {
    access_key: accessKeyAddress.toLowerCase(),
    wallet: walletAddress.toLowerCase(),
    ...networkFields(selectedChainId),
  };
  const walletKeys = state.accessKeys.filter((candidate) =>
    accessKeyMatches(candidate, { chainId: selectedChainId, walletAddress }),
  );
  const isRevoked = (candidate: WalletState["accessKeys"][number]) =>
    walletKeys.includes(candidate) && candidate.address.toLowerCase() === output.access_key;
  const stored = walletKeys.find(isRevoked);
  // A key created on another device is not stored here, but the chain shows whether it belongs
  // to the wallet. A mistyped address is neither stored nor authorized.
  const onChain = stored ? undefined : await readKey(target);
  const key =
    stored ??
    (onChain?.status === "published"
      ? {
          address: output.access_key,
          access: output.wallet,
          chainId: selectedChainId,
          expiry: onChain.expiry,
        }
      : undefined);
  if (!key)
    throw usageError(
      `Access key ${output.access_key} is not stored for wallet ${output.wallet} on ${network.name} or authorized for it on-chain. ${
        walletKeys.length
          ? `Its stored keys on ${network.name}: ${walletKeys.map((candidate) => candidate.address.toLowerCase()).join(", ")}.`
          : `It has no stored keys on ${network.name}.`
      }`,
    );

  const argv = [
    "wallet",
    "revoke",
    output.access_key,
    "--yes",
    ...(options.browser === false ? ["--no-browser"] : []),
  ];
  if (options["dry-run"])
    return {
      ...output,
      status: "dry_run" as const,
      local_key_removed: false,
      key: currentKeyOutput(key, undefined, await tokenDetails(keyTokens(key))),
      ...nextStep(
        "Review the key, then run the next command to revoke it on-chain. Revocation cannot be undone.",
        argv,
        { network },
      ),
    };

  if (!options.yes) {
    const command = continuationCommand(argv, network);
    if (context.agent)
      return context.error({
        code: "E_USAGE",
        message: `Revocation cannot be undone, so it needs confirmation. Review the key with --dry-run, then run '${command}'.`,
        exitCode: errorCodes.E_USAGE.exitCode,
        retryable: errorCodes.E_USAGE.retryable,
        cta: { commands: [{ command }] },
      });
    const confirm = dependencies.confirm ?? confirmPrompt;
    if (
      !(await confirm(
        `Revoke access key ${output.access_key} for wallet ${output.wallet} on ${network.name}? This cannot be undone.`,
      ))
    )
      throw usageError("Access key not revoked.");
  }

  // A key that is not published yet is authorized and revoked in one transaction; revoking it
  // alone would leave its signed authorization publishable.
  const keyAuthorization =
    stored &&
    localAccessKeyStatus(stored) === "pending" &&
    (await readKey(target)).status === "missing"
      ? stored.keyAuthorization
      : undefined;
  const provider = (dependencies.createProvider ?? createProvider)({
    network,
    noBrowser: options.browser === false,
  });
  await revokeAccessKeyThroughWallet({ provider, ...target, keyAuthorization });
  // The wallet app can return without revoking, for a key it could not find on-chain.
  if ((await readKey(target)).status !== "revoked")
    throw networkError(
      `The wallet app returned, but access key ${output.access_key} is not revoked on ${network.name}, so nothing was removed locally. Rerun the command to retry.`,
    );

  const accessKeys = state.accessKeys.filter((candidate) => !isRevoked(candidate));
  const localKeyRemoved = accessKeys.length !== state.accessKeys.length;
  if (localKeyRemoved) await saveWalletState({ ...state, accessKeys });

  return {
    ...output,
    status: "success" as const,
    local_key_removed: localKeyRemoved,
  };
}

/**
 * The wallet app signs the revocation, so the root account needs no local signer.
 * `wallet_revokeAccessKey` takes no chain: the wallet revokes on the provider's active chain,
 * which must be the key's.
 */
async function revokeAccessKeyThroughWallet(options: {
  provider: RevokeProvider;
  walletAddress: Address;
  accessKeyAddress: Address;
  chainId: number;
  keyAuthorization: unknown;
}) {
  const activeChainId = Number(await options.provider.request({ method: "eth_chainId" }));
  if (activeChainId !== options.chainId)
    throw usageError(
      "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
    );
  await options.provider.request({
    method: "wallet_revokeAccessKey",
    params: [
      // Encoded as the SDK encodes the request, from the stored signed authorization.
      z.encode(Rpc.wallet_revokeAccessKey.parameters, {
        address: options.walletAddress,
        accessKeyAddress: options.accessKeyAddress,
        ...(options.keyAuthorization
          ? { keyAuthorization: options.keyAuthorization as never }
          : {}),
      }),
    ],
  });
}

async function readAccessKeyOnChain(options: {
  chainId: number;
  walletAddress: Address;
  accessKeyAddress: Address;
}): Promise<OnChainKey> {
  const metadata = await Actions.accessKey
    .getMetadata(createTempoPublicClient(options.chainId), {
      account: options.walletAddress,
      accessKey: options.accessKeyAddress,
    })
    .catch(() => {
      throw networkError(
        `Unable to read access key ${options.accessKeyAddress.toLowerCase()} on-chain. Check RPC connectivity (TEMPO_RPC_URL).`,
      );
    });
  return {
    status: metadata.isRevoked
      ? "revoked"
      : metadata.address.toLowerCase() === options.accessKeyAddress.toLowerCase()
        ? "published"
        : "missing",
    // Zero means the key never expires.
    expiry: metadata.expiry > 0n ? Number(metadata.expiry) : undefined,
  };
}

export async function debugHandler(options: { network?: string | undefined }) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const network = await resolveNetwork(options.network, state);

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
    supported_shells: [...supportedShells],
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
  const [balance, assets, sessions, details] = await Promise.all([
    tokenBalance({ chain: options.chain, token, walletAddress: options.walletAddress }),
    fetchWalletAssets({
      chain: options.chain,
      walletAddress: options.walletAddress,
    }),
    sessionStats({ token, walletAddress: options.walletAddress }),
    tokenDetails(key ? keyTokens(key) : [{ chain: options.chain, token, read: true }]),
  ]);
  const symbol = details.get(tokenKey(options.chain, token))?.symbol ?? null;
  const balances = walletBalances({
    accessKey: key,
    assets,
    fallback: balance,
    fallbackVerified: knownToken(token, options.chain) !== undefined,
    symbol,
  });
  return {
    ready: Boolean(options.walletAddress && paymentKey && balance),
    wallet: options.walletAddress?.toLowerCase() ?? null,
    ...networkFields(options.chain),
    balance: {
      ...balanceOutput(balance, sessions, symbol),
      ...(options.walletAddress && !balance ? { error: balanceQueryError } : {}),
    },
    balances,
    key: key ? currentKeyOutput(key, balance, details) : null,
  };
}

/**
 * Labels each key from its own chain and wallet. Balances and unlisted tokens are queried only
 * for the active wallet's keys, so the RPC never learns the other stored wallets or their tokens;
 * their balances report `null`, and their unlisted tokens have no symbol or formatted limit.
 */
export async function currentKeysOutput(options: {
  walletAddress: string | null;
  accessKeys: WalletState["accessKeys"];
}) {
  const active = (key: WalletState["accessKeys"][number]) =>
    key.access.toLowerCase() === options.walletAddress?.toLowerCase();
  const balances = new Map<string, TokenBalance | null>();
  const details = await tokenDetails(
    options.accessKeys.flatMap((key) => keyTokens(key, active(key))),
  );
  const keys = [];
  for (const key of options.accessKeys) {
    if (!active(key)) {
      keys.push(currentKeyOutput(key, undefined, details));
      continue;
    }
    const token = key.limits?.[0]?.token ?? tokenAddress(key.chainId);
    const balanceKey = `${key.chainId}:${token}`.toLowerCase();
    const balance = balances.has(balanceKey)
      ? (balances.get(balanceKey) ?? null)
      : await tokenBalance({ chain: key.chainId, token, walletAddress: key.access });
    balances.set(balanceKey, balance);
    keys.push(currentKeyOutput(key, balance, details));
  }

  return {
    keys,
    total: keys.length,
  };
}

/** `balance` is `undefined` when it was not queried and `null` when the query failed. */
function currentKeyOutput(
  key: WalletState["accessKeys"][number],
  balance: TokenBalance | null | undefined,
  details: TokenDetails,
) {
  const limit = key.limits?.[0];
  const spendingMode = permissionMode(key.limits, key.permissionSemantics);
  const callMode = permissionMode(key.scopes, key.permissionSemantics);
  const token = limit?.token ?? tokenAddress(key.chainId);
  const tokenDetail = details.get(tokenKey(key.chainId, token));
  const spendingLimits = accessKeyLimitsOutput(key, details);
  return {
    address: key.address.toLowerCase(),
    ...networkFields(key.chainId),
    wallet_address: key.access.toLowerCase(),
    symbol: tokenDetail?.symbol ?? null,
    token: token.toLowerCase(),
    balance:
      balance && balance.token.toLowerCase() === token.toLowerCase() ? balance.formatted : null,
    ...(balance === null ? { balance_error: balanceQueryError } : {}),
    spending_limit: {
      mode: spendingMode,
      unlimited: spendingMode === "unknown" ? null : spendingMode === "unrestricted",
      limit:
        spendingMode === "none"
          ? "0.000000"
          : spendingMode === "restricted" && limit
            ? formatLimit(limit.limit, tokenDetail)
            : null,
      raw_limit:
        spendingMode === "none"
          ? "0"
          : spendingMode === "restricted" && limit
            ? cleanStoredScalar(limit.limit)
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

function accessKeyLimitsOutput(key: WalletState["accessKeys"][number], details: TokenDetails) {
  return (key.limits ?? []).map((limit) => {
    const detail = details.get(tokenKey(key.chainId, limit.token));
    return {
      unlimited: false,
      symbol: detail?.symbol ?? null,
      token: limit.token.toLowerCase(),
      limit: formatLimit(limit.limit, detail),
      raw_limit: cleanStoredScalar(limit.limit),
      period_seconds: limit.period ?? null,
      remaining: null,
      spent: null,
    };
  });
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

type TokenBalance = {
  formatted: string;
  raw: bigint;
  token: string;
};

type TokenDetail = { symbol: string | null; decimals: number | null };
type TokenDetails = Map<string, TokenDetail>;

const unknownToken: TokenDetail = { symbol: null, decimals: null };

function tokenKey(chain: number, token: string) {
  return `${chain}:${token.toLowerCase()}`;
}

/**
 * A key's primary token, then each token it has a limit for, on the key's chain. `read` allows an
 * unlisted token to be read on chain.
 */
function keyTokens(key: WalletState["accessKeys"][number], read = true) {
  return [
    key.limits?.[0]?.token ?? tokenAddress(key.chainId),
    ...(key.limits ?? []).map((limit) => limit.token),
  ].map((token) => ({ chain: key.chainId, token, read }));
}

/**
 * Display symbols and decimals by `tokenKey`: viem's listing, else read on chain when an entry
 * allows it. A token not read or unreadable has neither. Each distinct chain and token is looked
 * up once, and the lookups run in parallel.
 */
async function tokenDetails(
  tokens: readonly { chain: number; token: string; read: boolean }[],
): Promise<TokenDetails> {
  const unique = new Map<string, (typeof tokens)[number]>();
  for (const entry of tokens) {
    const id = tokenKey(entry.chain, entry.token);
    unique.set(id, { ...entry, read: entry.read || unique.get(id)?.read === true });
  }
  const details = await Promise.all(
    [...unique].map(async ([id, { chain, token, read }]) => {
      if (!read && !knownToken(token, chain)) return [id, unknownToken] as const;
      const readOnChain = (address: Address) =>
        readTokenMetadata(address, chain, { timeout: statusQueryTimeout, retryCount: 0 });
      const detail: TokenDetail = await tokenMetadata(
        token.toLowerCase() as Address,
        chain,
        readOnChain,
      ).then(
        ({ symbol, decimals }) => ({ symbol, decimals }),
        () => unknownToken,
      );
      return [id, detail] as const;
    }),
  );
  return new Map(details);
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

function debugOs() {
  if (platform === "darwin") return "macos";
  return platform;
}

function debugArch() {
  if (arch === "arm64") return "aarch64";
  return arch;
}

/** Key management signs through the wallet session, so it must target the logged-in chain. */
function requireWalletChain({ network, state }: Wallet) {
  if (storedChainId(state) !== network.chainId)
    throw usageError(
      "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
    );
}
