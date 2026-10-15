import { access } from "node:fs/promises";
import { Rpc, type Provider as CoreProvider } from "accounts";
import { z } from "incur";
import { erc20Abi, formatUnits, isAddress, parseUnits, toHex, type Address } from "viem";
import { Actions } from "viem/tempo";

import {
  appUrl,
  createTempoPublicClient,
  explicitNetwork,
  networkFields,
  networkName,
  parseNetwork,
  resolveNetwork,
  storedChainId,
  tokenAddress,
  type Network,
} from "../shared/network.js";
import {
  commandError,
  errorCodes,
  networkError,
  usageError,
  type WalletErrorCode,
} from "../shared/errors.js";
import { continuationCommand, nextStep, shellQuote } from "../shared/next.js";
import type { Wallet } from "../shared/require-wallet.js";
import { channelsDbPath, confirm as confirmPrompt, querySql } from "../shared/process.js";
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
import { connect, createProvider, settleWalletStore } from "../provider.js";
import {
  clearPendingLogin,
  emptyWalletState,
  loadPendingLogin,
  loadWalletState,
  saveWalletState,
  type WalletState,
} from "../wallet/store.js";
import {
  accessKeyMatches,
  isPaymentCapableStatus,
  localAccessKeyStatus,
  selectPaymentCapableAccessKey,
  type LocalAccessKeyStatus,
} from "../wallet/access-key.js";
import { queryMachBalance } from "../shared/mach.js";
import { queryCreditBalance, warnCreditsDeprecated } from "./credits.js";
import { fundedSessions } from "./sessions.js";

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
  }) => Promise<Pick<CoreProvider.Provider, "request">> = createProvider,
) {
  const network = await resolveNetwork(options.network);
  const result = await connect(
    await createRefreshProvider({ network, noBrowser: options.browser === false }),
    network,
  );

  return {
    accounts: result.accounts.map((account) => account.address),
    chainId: network.chainId,
  };
}

/**
 * Logs out of `network` (`--network` or `TEMPO_WALLET_NETWORK`), or of every network without one,
 * and cancels a pending login for the networks logged out. Accounts are not stored per network,
 * so logging out of one network removes its access keys and keeps the wallet while it has its own
 * keys on another network. With `revoke`, each key is first revoked on-chain through the wallet
 * app; a key the chain does not show revoked is kept, with the wallet, and the command fails.
 * Logging out while stored sessions hold unspent deposits, or with `revoke`, needs confirmation:
 * a prompt on interactive runs, `--yes` on agent runs.
 */
export async function logoutHandler(
  options: {
    network?: string | undefined;
    revoke?: boolean | undefined;
    yes?: boolean | undefined;
    browser?: boolean | undefined;
  },
  context: CommandContext,
  dependencies: {
    confirm?: (question: string) => Promise<boolean>;
    createProvider?: (options: {
      network: Network;
      noBrowser?: boolean | undefined;
    }) => Promise<RevokeProvider>;
    readKey?: OnChainKeyReader;
  } = {},
) {
  const state = await loadWalletState();
  const network = explicitNetwork(options.network);
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const keys = network
    ? state.accessKeys.filter((key) => key.chainId === network.chainId)
    : state.accessKeys;
  const where = network?.name ?? "every network";
  const flags = { revoke: options.revoke, yes: options.yes, browser: options.browser, network };
  const output = {
    wallet: activeAccount?.address.toLowerCase() ?? null,
    scope: network?.name ?? ("all" as const),
  };
  // The wallet counts as logged in on its stored network even once it has no keys there.
  const wasLoggedIn = network
    ? keys.length > 0 || (state.accounts.length > 0 && storedChainId(state) === network.chainId)
    : state.accounts.length > 0 || state.accessKeys.length > 0;
  if (!wasLoggedIn) {
    await clearLoggedOutPendingLogin(network);
    return {
      was_logged_in: false,
      disconnected: false,
      ...output,
      keys: [],
      sessions: [],
      message: network ? `not logged in on ${network.name}` : "not logged in",
    };
  }

  // An expired key can neither sign nor have its authorization published, so it has nothing to
  // revoke, and the wallet app cannot revoke one the chain does not hold. A key only looks expired
  // locally when the clock is ahead of the chain's or its stored expiry is zero, which the chain
  // reads as none, so a locally expired key is revoked anyway while the chain shows it published.
  const readKey = dependencies.readKey ?? readAccessKeyOnChain;
  const revocable: WalletState["accessKeys"][number][] = [];
  for (const key of options.revoke ? keys : [])
    if (
      localAccessKeyStatus(key) !== "expired" ||
      (await readKey(keyTarget(key))).status === "published"
    )
      revocable.push(key);
  // `wallet_revokeAccessKey` takes no chain, so the wallet app revokes on the stored chain only.
  const walletChainId = storedChainId(state);
  const elsewhere = revocable.find((key) => key.chainId !== walletChainId);
  if (elsewhere) {
    const walletNetwork = chainNetwork(walletChainId);
    const keyNetwork = chainNetwork(elsewhere.chainId);
    const reason = `The wallet app revokes access keys only on the network the wallet is logged in on (${walletNetwork.name}), not on ${keyNetwork.name}.`;
    if (revocable.some((key) => key.chainId === walletChainId)) {
      const command = logoutCommand({ ...flags, network: walletNetwork });
      return context.error(
        commandError(
          "E_USAGE",
          `${reason} Run '${command}' to revoke the ${walletNetwork.name} keys first; the wallet then stays logged in on ${keyNetwork.name}, where '${logoutCommand({ ...flags, network: keyNetwork })}' revokes the rest.`,
          command,
        ),
      );
    }
    const command = continuationCommand(["wallet", "login"], keyNetwork);
    return context.error(
      commandError(
        "E_USAGE",
        `${reason} Run '${command}', then rerun '${logoutCommand(flags)}', or rerun without --revoke to remove the keys without revoking them.`,
        command,
      ),
    );
  }

  const next = loggedOutState(state, network);
  const disconnected = next.accounts.length === 0;
  const { sessions, unchecked } = await readFundedSessions({
    payers: [...state.accounts.map((account) => account.address), ...keys.map((key) => key.access)],
    // A logout that removes the wallet leaves its sessions on every network without a login.
    chainId: disconnected ? undefined : network?.chainId,
  });
  const closeSteps = sessionCloseSteps(sessions);
  const reasons = [
    ...(unchecked ? [`The ${unchecked}.`] : []),
    ...(sessions.length > 0 ? [fundedSessionsReason(sessions, closeSteps)] : []),
    ...(revocable.length > 0
      ? [
          `--revoke revokes ${count(revocable.length, "access key")} on-chain, which cannot be undone.`,
        ]
      : []),
  ];
  if (reasons.length > 0 && !options.yes) {
    if (context.agent) {
      const command = logoutCommand({ ...flags, yes: true });
      return context.error(
        commandError(
          "E_USAGE",
          `Logging out of ${where} needs confirmation. ${reasons.join(" ")} To log out anyway, run '${command}'.`,
          command,
        ),
      );
    }
    const confirm = dependencies.confirm ?? confirmPrompt;
    if (!(await confirm(`${reasons.join(" ")} Log out of ${where}?`)))
      throw usageError("Wallet not logged out.");
  }

  const revoked: WalletState["accessKeys"][number][] = [];
  if (revocable.length > 0) {
    const walletNetwork = chainNetwork(walletChainId);
    const provider = await (dependencies.createProvider ?? createProvider)({
      network: walletNetwork,
      noBrowser: options.browser === false,
    });
    for (const key of revocable) {
      const failure = await revokeThroughWallet({
        provider,
        readKey,
        stored: key,
        target: keyTarget(key),
      }).then(
        (done) =>
          done
            ? undefined
            : networkError("The wallet app returned, but the chain does not show it revoked."),
        (error: unknown) => error,
      );
      if (failure === undefined) {
        revoked.push(key);
        continue;
      }
      // Only the revoked keys go. The SDK drops a key from the store once the wallet app returns,
      // even when the chain does not show it revoked, so the rest are restored from the snapshot.
      await settleWalletStore();
      await saveWalletState({
        ...state,
        accessKeys: state.accessKeys.filter((candidate) => !revoked.some(sameKey(candidate))),
      });
      const command = logoutCommand(flags);
      return context.error(
        commandError(
          walletErrorCode(failure),
          `Not logged out: access key ${key.address.toLowerCase()} on ${walletNetwork.name} was not revoked, so it stays on this machine with the wallet${revoked.length > 0 ? ` (revoked and removed: ${revoked.map((candidate) => candidate.address.toLowerCase()).join(", ")})` : ""}. ${failure instanceof Error ? failure.message : String(failure)} Rerun '${command}' to retry, or rerun without --revoke to remove the keys without revoking them.`,
          command,
        ),
      );
    }
    // The SDK writes the store after each revocation; let those writes land before this one.
    await settleWalletStore();
  }

  const message = [
    `logged out of ${where}`,
    disconnected
      ? "wallet disconnected"
      : `still logged in on ${chainNetwork(storedChainId(next)).name}`,
    ...(revoked.length > 0
      ? [`${count(revoked.length, "access key")} revoked on-chain and removed`]
      : []),
    ...(keys.length === revoked.length
      ? []
      : options.revoke
        ? [
            `${count(keys.length - revoked.length, "expired access key")} removed without revoking, since none is published on-chain`,
          ]
        : [
            `${count(keys.length, "access key")} removed locally but not revoked, so authorized on-chain until expiry (use --revoke to revoke)`,
          ]),
    ...(unchecked ? [unchecked] : []),
  ].join("; ");
  await saveWalletState(next);
  // A pending login must not bring the wallet back after logout.
  await clearLoggedOutPendingLogin(network);

  return {
    was_logged_in: true,
    disconnected,
    ...output,
    keys: keys.map((key) => ({
      address: key.address.toLowerCase(),
      wallet_address: key.access.toLowerCase(),
      ...networkFields(key.chainId),
      revoked: revoked.some(sameKey(key)),
    })),
    sessions,
    message,
    ...sessionsNextStep(sessions.length, closeSteps),
  };
}

/**
 * The store after logging out of `network`, or of every network without one. The active wallet
 * stays while it has its own keys on another network, and the store's chain, the one the wallet
 * app acts on, moves off the network logged out to one of those; otherwise the wallet is removed
 * and only other wallets' keys on other networks are kept.
 */
function loggedOutState(state: WalletState, network: Network | undefined): WalletState {
  if (!network) return emptyWalletState();
  const accessKeys = state.accessKeys.filter((key) => key.chainId !== network.chainId);
  const active = state.accounts[state.activeAccount ?? 0];
  const kept =
    active && accessKeys.find((key) => key.access.toLowerCase() === active.address.toLowerCase());
  if (!kept) return { ...emptyWalletState(), accessKeys };
  if (storedChainId(state) !== network.chainId) return { ...state, accessKeys };
  return { ...state, accessKeys, chainId: kept.chainId };
}

/** Cancels the pending login when it is for a network logged out. */
async function clearLoggedOutPendingLogin(network: Network | undefined) {
  if (!network) return await clearPendingLogin();
  const pending = await loadPendingLogin();
  if (pending?.network === network.name) await clearPendingLogin(pending.registration.device_code);
}

/** A logout command; without a network it logs out of every network, so it has no `--network`. */
function logoutCommand(options: {
  network?: Network | undefined;
  revoke?: boolean | undefined;
  yes?: boolean | undefined;
  browser?: boolean | undefined;
}) {
  const argv = [
    "wallet",
    "logout",
    ...(options.revoke ? ["--revoke"] : []),
    ...(options.yes ? ["--yes"] : []),
    ...(options.browser === false ? ["--no-browser"] : []),
  ];
  return options.network
    ? continuationCommand(argv, options.network)
    : ["tempo", ...argv].map(shellQuote).join(" ");
}

/** Per network, the `sessions close` that withdraws its sessions: `--finalize` once all can be. */
function sessionCloseSteps(sessions: readonly { network: string; status: string }[]) {
  return [...new Set(sessions.map((session) => session.network))].map((name) => ({
    network: parseNetwork(name),
    argv: [
      "wallet",
      "sessions",
      "close",
      sessions.every((session) => session.network !== name || session.status === "finalizable")
        ? "--finalize"
        : "--all",
    ],
  }));
}

/**
 * The stored sessions that still hold deposits, or `unchecked` saying why the session store could
 * not be read; logout then needs the confirmation funded sessions need. Without sqlite3 and
 * without a session store, no session was ever stored.
 */
async function readFundedSessions(options: Parameters<typeof fundedSessions>[0]) {
  try {
    return { sessions: await fundedSessions(options), unchecked: undefined };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    const stored = await access(channelsDbPath()).then(
      () => true,
      () => false,
    );
    if (missing && !stored) return { sessions: [], unchecked: undefined };
    const reason = missing
      ? "sqlite3 is not installed"
      : (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
    return {
      sessions: [],
      unchecked: `stored sessions in ${channelsDbPath()} could not be checked for unspent deposits (${reason})`,
    };
  }
}

/** Why logging out needs confirmation while `sessions` hold deposits, and how to close them. */
function fundedSessionsReason(
  sessions: Awaited<ReturnType<typeof fundedSessions>>,
  steps: ReturnType<typeof sessionCloseSteps>,
) {
  const listed = sessions.map(
    (session) =>
      `${session.remaining} ${session.symbol ?? "tokens"} with ${session.origin || session.channel_id} on ${session.network} (${session.status})`,
  );
  const commands = steps.map((step) => `'${continuationCommand(step.argv, step.network)}'`);
  return `Unspent deposits remain in ${count(sessions.length, "stored session")}: ${listed.join("; ")}. Withdrawing them after logout needs a new login, so close them first with ${commands.join(" and ")}.`;
}

/** Points sessions left holding deposits at the login and close that withdraw them. */
function sessionsNextStep(total: number, steps: ReturnType<typeof sessionCloseSteps>) {
  const login = (network: Network) => continuationCommand(["wallet", "login"], network);
  const [single] = steps;
  if (!single) return {};
  if (steps.length === 1)
    return nextStep(
      `Unspent deposits remain in ${count(total, "stored session")} on ${single.network.name}. Log in again with '${login(single.network)}', then run the next command to close them and withdraw the deposits.`,
      single.argv,
      { network: single.network },
    );
  return {
    instruction: `Unspent deposits remain in ${count(total, "stored session")} on ${steps.length} networks. To withdraw them, log in again on each network and close its sessions: ${steps
      .map(
        (step) =>
          `'${login(step.network)}', then '${continuationCommand(step.argv, step.network)}'`,
      )
      .join("; ")}.`,
  };
}

function count(total: number, noun: string) {
  return `${total} ${noun}${total === 1 ? "" : "s"}`;
}

function chainNetwork(chainId: number) {
  return parseNetwork(networkName(chainId));
}

function keyTarget(key: WalletState["accessKeys"][number]) {
  return {
    chainId: key.chainId,
    walletAddress: key.access as Address,
    accessKeyAddress: key.address as Address,
  };
}

function sameKey(key: WalletState["accessKeys"][number]) {
  return (candidate: WalletState["accessKeys"][number]) =>
    candidate.chainId === key.chainId &&
    candidate.address.toLowerCase() === key.address.toLowerCase() &&
    candidate.access.toLowerCase() === key.access.toLowerCase();
}

/** The wallet error code a failure carries, or `E_NETWORK` for a failed wallet-app request. */
function walletErrorCode(error: unknown): WalletErrorCode {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && Object.hasOwn(errorCodes, code)
    ? (code as WalletErrorCode)
    : "E_NETWORK";
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
  }) => Promise<UpdateAccessKeyProvider> = createProvider,
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
  const provider = await createUpdateProvider({ network, noBrowser: options.browser === false });

  await updateAccessKey({
    provider,
    walletAddress,
    accessKeyAddress,
    chainId: selectedChainId,
    token,
    limit,
  });

  // For an unpublished key the SDK saves the wallet's replacement authorization in the
  // background, so reload the store once it lands and change only the limit.
  await settleWalletStore();
  const current = await loadWalletState();
  const accessKeys = current.accessKeys.map((candidate) => {
    if (
      candidate.address.toLowerCase() !== accessKeyAddress.toLowerCase() ||
      !accessKeyMatches(candidate, { chainId: selectedChainId, walletAddress })
    )
      return candidate;
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
  await saveWalletState({ ...current, accessKeys });

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

/**
 * What `revoke` and `logout` use of incur's run context: `agent` is set when no one can answer a
 * prompt, and `error` keeps the `cta` that thrown errors lose.
 */
type CommandContext = {
  agent: boolean;
  error: (error: ReturnType<typeof commandError>) => never;
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
  context: CommandContext,
  dependencies: {
    confirm?: (question: string) => Promise<boolean>;
    createProvider?: (options: {
      network: Network;
      noBrowser?: boolean | undefined;
    }) => Promise<RevokeProvider>;
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
      return context.error(
        commandError(
          "E_USAGE",
          `Revocation cannot be undone, so it needs confirmation. Review the key with --dry-run, then run '${command}'.`,
          command,
        ),
      );
    const confirm = dependencies.confirm ?? confirmPrompt;
    if (
      !(await confirm(
        `Revoke access key ${output.access_key} for wallet ${output.wallet} on ${network.name}? This cannot be undone.`,
      ))
    )
      throw usageError("Access key not revoked.");
  }

  const provider = await (dependencies.createProvider ?? createProvider)({
    network,
    noBrowser: options.browser === false,
  });
  const revoked = await revokeThroughWallet({ provider, readKey, stored, target });
  // The SDK drops the key from the store once the wallet app returns, even when the chain does
  // not show it revoked; let that write land, then restore the key from the snapshot.
  await settleWalletStore();
  if (!revoked) {
    if (stored) await saveWalletState(state);
    throw networkError(
      `The wallet app returned, but access key ${output.access_key} is not revoked on ${network.name}, so nothing was removed locally. Rerun the command to retry.`,
    );
  }

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
 * Asks the wallet app to revoke a key and returns whether the chain then shows it revoked, since
 * the wallet app can return without revoking a key it could not find on-chain. `stored` is the
 * key's local copy, if any.
 */
async function revokeThroughWallet(options: {
  provider: RevokeProvider;
  readKey: OnChainKeyReader;
  stored: WalletState["accessKeys"][number] | undefined;
  target: { chainId: number; walletAddress: Address; accessKeyAddress: Address };
}) {
  const { provider, readKey, stored, target } = options;
  // A key that is not published yet is authorized and revoked in one transaction; revoking it
  // alone would leave its signed authorization publishable.
  const keyAuthorization =
    stored &&
    localAccessKeyStatus(stored) === "pending" &&
    (await readKey(target)).status === "missing"
      ? stored.keyAuthorization
      : undefined;
  await revokeAccessKeyThroughWallet({ provider, ...target, keyAuthorization });
  return (await readKey(target)).status === "revoked";
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

/**
 * Labels each key from its own chain and wallet, and reads it on that chain. Balances, unlisted
 * tokens, and on-chain key state are queried only for the active wallet's keys, so the RPC never
 * learns the other stored wallets or their tokens; their balances, `published`, and remaining
 * limits report `null`, and their unlisted tokens have no symbol or formatted limit.
 */
export async function currentKeysOutput(options: {
  walletAddress: string | null;
  accessKeys: WalletState["accessKeys"];
}) {
  const active = (key: WalletState["accessKeys"][number]) =>
    key.access.toLowerCase() === options.walletAddress?.toLowerCase();
  const balances = new Map<string, TokenBalance | null>();
  const servesChain = rpcChainCheck();
  const [details, chainKeys] = await Promise.all([
    tokenDetails(options.accessKeys.flatMap((key) => keyTokens(key, active(key)))),
    Promise.all(
      options.accessKeys.map((key) => (active(key) ? readChainKey(key, servesChain) : undefined)),
    ),
  ]);
  const keys = [];
  for (const [index, key] of options.accessKeys.entries()) {
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
    keys.push(currentKeyOutput(key, balance, details, chainKeys[index]));
  }

  return {
    keys,
    total: keys.length,
  };
}

/**
 * `balance` is `undefined` when it was not queried and `null` when the query failed; `chainKey` is
 * `undefined` when the key was not read on chain.
 */
function currentKeyOutput(
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
 * Whether reads for a chain reach it. `TEMPO_RPC_URL` serves every network, so with it set each
 * distinct chain asks the endpoint's `eth_chainId` once, bounded and without retries, and a failed
 * call counts as another chain. The per-chain default URLs need no check.
 */
function rpcChainCheck() {
  const checks = new Map<number, Promise<boolean>>();
  return (chain: number) => {
    if (!process.env.TEMPO_RPC_URL) return Promise.resolve(true);
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
async function readChainKey(
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

/** Key management signs through the wallet session, so it must target the logged-in chain. */
function requireWalletChain({ network, state }: Wallet) {
  if (storedChainId(state) !== network.chainId)
    throw usageError(
      "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
    );
}
