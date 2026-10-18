import { access } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { Cli } from "incur";
import type { Address } from "viem";

import { destructive, type WalletCommand } from "../cli/command.js";
import { flag } from "../cli/describe.js";
import { logoutOptions, logoutOutput } from "../schemas/logout.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import {
  explicitNetwork,
  networkFields,
  networkName,
  parseNetwork,
  requireRpcChain,
  storedChainId,
  type Network,
} from "../shared/network.js";
import {
  commandError,
  errorCodes,
  networkError,
  usageError,
  type CommandContext,
  type WalletErrorCode,
} from "../shared/errors.js";
import { continuationCommand, nextStep, shellQuote } from "../shared/next.js";
import { canPrompt, channelsDbPath, confirm as confirmPrompt } from "../shared/process.js";
import { createRevokeProvider } from "../provider.js";
import {
  clearPendingFund,
  clearPendingLogin,
  emptyWalletState,
  loadPendingFund,
  loadPendingLogin,
  loadWalletState,
  saveWalletState,
  updateWalletState,
  type WalletState,
} from "../wallet/store.js";
import { localAccessKeyStatus } from "../wallet/access-key.js";
import {
  readAccessKeyOnChain,
  revokeThroughWallet,
  type OnChainKeyReader,
  type RevokeProvider,
} from "../wallet/revocation.js";
import { fundedSessions } from "./sessions/list.js";

export default {
  command: Cli.create("logout", {
    description: "Log out of every network, or of one with --network",
    globals: cliGlobals,
    options: logoutOptions,
    alias: globalAlias,
    output: logoutOutput,
    async run(context) {
      return logoutHandler(
        { ...context.options, network: context.globals.network },
        // Piped stdin cannot answer the prompt, so such a run confirms like an agent's, with --yes.
        { ...context, agent: !canPrompt(context.agent) },
      );
    },
  }),
  annotations: {
    // With `revoke`, asks the wallet app to revoke the keys and reads them on-chain.
    logout: { ...destructive, idempotentHint: true, openWorldHint: true },
  },
  describe: {
    name: "logout",
    about: "Log out of every network, or of one with --network",
    args: [
      flag(
        "revoke",
        "--revoke",
        "Revoke the access keys on-chain through the wallet app before removing them",
      ),
      flag(
        "yes",
        "--yes",
        "Log out without a prompt when stored sessions hold unspent deposits or with --revoke",
      ),
      flag("no_browser", "--no-browser", "Do not attempt to open a browser"),
    ],
  },
} satisfies WalletCommand;

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
    const notCancelled = await cancelLoggedOutPendingLogin(network, logoutCommand(flags));
    if (notCancelled) return context.error(notCancelled);
    await clearLoggedOutPendingFund(network);
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
  // Each key is revoked and then read on its own network, so an RPC override that serves another
  // chain stops the logout before anything is revoked rather than partway through.
  for (const chainId of new Set(revocable.map((key) => key.chainId)))
    await requireRpcChain(chainId);

  const disconnected = loggedOutState(state, network).accounts.length === 0;
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

  // A pending login must not bring the wallet back after logout. It is cancelled before any key is
  // revoked or the wallet store changes, so a logout that cannot cancel it fails having changed
  // nothing.
  const notCancelled = await cancelLoggedOutPendingLogin(network, logoutCommand(flags));
  if (notCancelled) return context.error(notCancelled);

  const revoked: WalletState["accessKeys"][number][] = [];
  if (revocable.length > 0) {
    // One provider revokes the keys on every network: each revocation names its key's.
    const provider = await (dependencies.createProvider ?? createRevokeProvider)({
      network: chainNetwork(storedChainId(state)),
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
      await removeRevoked(revoked);
      const command = logoutCommand(flags);
      return context.error(
        commandError(
          walletErrorCode(failure),
          `Not logged out: access key ${key.address.toLowerCase()} on ${chainNetwork(key.chainId).name} was not revoked, so it stays on this machine with the wallet${revoked.length > 0 ? ` (revoked and removed: ${revoked.map((candidate) => candidate.address.toLowerCase()).join(", ")})` : ""}. ${failure instanceof Error ? failure.message : String(failure)} Rerun '${command}' to retry, or rerun without --revoke to remove the keys without revoking them.`,
          command,
        ),
      );
    }
  }

  // Another process can change the store while the prompt or the wallet app waits. A login or
  // refresh that changes what this logout covers stops it before it writes, so that login is kept
  // and a rerun logs out of the store as it is; a change only to keys on other networks is kept.
  const current = await loadWalletState();
  if (scopeChanged(current, state, network)) {
    await removeRevoked(revoked);
    const command = logoutCommand(flags);
    return context.error(
      commandError(
        "E_USAGE",
        `The wallet changed while logging out of ${where}, so it was not logged out${revoked.length > 0 ? ` (revoked on-chain and removed: ${revoked.map((key) => key.address.toLowerCase()).join(", ")})` : ""}. Run '${command}' again.`,
        command,
        { retryable: true },
      ),
    );
  }
  const loggedOut = loggedOutState(current, network);
  await saveWalletState(loggedOut);
  const loggedOutDisconnected = loggedOut.accounts.length === 0;
  const message = [
    `logged out of ${where}`,
    loggedOutDisconnected
      ? "wallet disconnected"
      : `still logged in on ${chainNetwork(storedChainId(loggedOut)).name}`,
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
  // The logged-in wallet's pending funding must not hand its checkout to whoever logs in next.
  await clearLoggedOutPendingFund(network);

  return {
    was_logged_in: true,
    disconnected: loggedOutDisconnected,
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

/**
 * Cancels the pending login when it is for a network logged out. Returns the retryable error to
 * fail the logout with when it cannot, naming `command` to rerun.
 */
async function cancelLoggedOutPendingLogin(network: Network | undefined, command: string) {
  try {
    if (!network) return await clearPendingLogin();
    const pending = await loadPendingLogin();
    if (pending?.network === network.name)
      await clearPendingLogin(pending.registration.device_code);
  } catch (error) {
    return commandError(
      walletErrorCode(error, "E_RUNTIME"),
      `Not logged out: the pending login could not be cancelled. ${error instanceof Error ? error.message : String(error)} Rerun '${command}' to retry.`,
      command,
      { retryable: true },
    );
  }
}

/**
 * Cancels the logged-in wallet's pending funding when it is for a network logged out. An
 * `--address` funding is not tied to the login, so it is kept.
 */
async function clearLoggedOutPendingFund(network: Network | undefined) {
  const pending = await loadPendingFund();
  if (pending?.activeWallet && (!network || pending.network === network.name))
    await clearPendingFund(pending);
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

/**
 * Removes the keys a logout that stops early has revoked, and only them, from the store as it is
 * now; the provider that revoked them never writes the store.
 */
async function removeRevoked(revoked: WalletState["accessKeys"]) {
  if (revoked.length === 0) return;
  await updateWalletState((current) => ({
    ...current,
    accessKeys: current.accessKeys.filter((candidate) => !revoked.some(sameKey(candidate))),
  }));
}

/**
 * Whether `current` differs from `state`, the store the logout read, in what logging out of
 * `network` (every network without one) covers: the wallets, the active wallet, the stored network,
 * or the keys on the networks logged out.
 */
function scopeChanged(current: WalletState, state: WalletState, network: Network | undefined) {
  const scope = (store: WalletState) => ({
    accounts: store.accounts.map((account) => account.address.toLowerCase()),
    activeAccount: store.activeAccount ?? 0,
    chainId: storedChainId(store),
    accessKeys: store.accessKeys
      .filter((key) => network === undefined || key.chainId === network.chainId)
      .map((key) => `${key.chainId}:${key.access.toLowerCase()}:${key.address.toLowerCase()}`)
      .sort(),
  });
  return !isDeepStrictEqual(scope(current), scope(state));
}

function sameKey(key: WalletState["accessKeys"][number]) {
  return (candidate: WalletState["accessKeys"][number]) =>
    candidate.chainId === key.chainId &&
    candidate.address.toLowerCase() === key.address.toLowerCase() &&
    candidate.access.toLowerCase() === key.access.toLowerCase();
}

/** The wallet error code a failure carries, or `E_NETWORK` for a failed wallet-app request. */
function walletErrorCode(error: unknown, fallback: WalletErrorCode = "E_NETWORK"): WalletErrorCode {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && Object.hasOwn(errorCodes, code)
    ? (code as WalletErrorCode)
    : fallback;
}
