import type { z } from "incur";
import { encodeFunctionData, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Abis as TempoAbis } from "viem/tempo";
import { Challenge, Credential } from "mppx";

import { destructive } from "../../cli/command.js";
import { flag, positional } from "../../cli/describe.js";
import {
  sessionsCloseArgs,
  sessionsCloseCommandOutput,
  sessionsCloseOptions,
} from "../../schemas/sessions.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import { escrowAbi } from "../../shared/constants.js";
import {
  commandError,
  paymentError,
  paymentOutcomeUnknownError,
  usageError,
  walletError,
  type CommandContext,
} from "../../shared/errors.js";
import {
  escrowContract,
  networkName,
  parseNetwork,
  requireRpcChain,
  storedChainId,
  tokenAddress,
  tokenDecimals,
  type Network,
} from "../../shared/network.js";
import { canPrompt, confirm as confirmPrompt } from "../../shared/process.js";
import { tokenSymbol } from "../../shared/tokens.js";
import {
  decodeBase64UrlJson,
  formatTokenUnits,
  formatUnixTimestamp,
  getRecord,
  isChannelId,
  normalizeOrigin,
  nowSeconds,
  sanitizeText,
  stringValue,
} from "../../shared/utils.js";
import { continuationCommand, nextStep } from "../../shared/next.js";
import { withWallet, type Wallet } from "../../shared/require-wallet.js";
import { createProvider, requireSender } from "../../provider.js";
import { getOnChainChannel, isPrecompileEscrow, readGracePeriod } from "../../payment/channel.js";
import { requireSessionDescriptor } from "../../payment/session-descriptor.js";
import { loadWalletState } from "../../wallet/store.js";
import {
  deleteChannelRecord,
  discoverAndPersistOrphanedChannels,
  readChannelRecords,
  sessionStatus,
  updateChannelCloseState,
  type ChannelRecord,
  type ChannelState,
} from "./records.js";

/** Whether a `sessions close` left a channel unclosed; a one-shot CLI run then exits 1. */
export let closeCommandFailed = false;

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type CloseContext = CommandContext & {
  args: z.output<typeof sessionsCloseArgs>;
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof sessionsCloseOptions>;
};

export const closeCommand = {
  description: "Request a session close, then withdraw after the grace period with --finalize",
  args: sessionsCloseArgs,
  options: sessionsCloseOptions,
  alias: globalAlias,
  output: sessionsCloseCommandOutput,
  // Close and withdraw transactions fall back to wallet app approval, so channel funds stay
  // recoverable without a usable access key.
  // Piped stdin cannot answer the prompt, so such a run confirms like an agent's, with --yes.
  run: withWallet(
    async (context: CloseContext, wallet) => {
      const { args, options } = context;
      const close = {
        all: options.all,
        cooperative: options.cooperative,
        finalize: options.finalize,
        orphaned: options.orphaned,
        target: args.url,
        yes: options.yes,
      };
      if (options["dry-run"]) return dryRunCloseSessions(wallet, close);
      const summary = await closeSessions(wallet, close, {
        ...context,
        agent: !canPrompt(context.agent),
      });
      closeCommandFailed = summary.failed > 0;
      return summary;
    },
    { requireKey: "never" },
  ),
};

export const closeAnnotations = { ...destructive, idempotentHint: false, openWorldHint: true };

export const closeDescribe = {
  name: "close",
  about: "Request a session close, then withdraw after the grace period with --finalize",
  args: [
    positional("url", "URL, origin, or channel ID (0x...) to close"),
    flag("all", "--all", "Close all active sessions and on-chain channels"),
    flag("orphaned", "--orphaned", "Close only orphaned on-chain channels"),
    flag("finalize", "--finalize", "Withdraw channels whose close grace period has ended"),
    flag(
      "cooperative",
      "--cooperative",
      "Close now through the session's server instead of waiting out the grace period",
    ),
    flag("dry_run", "--dry-run", "Show what would be closed without executing"),
    flag("yes", "--yes", "Close without the confirmation prompt; required for agent runs"),
  ],
};

type CloseResultRecord = {
  channel_id: string;
  status: "closed" | "pending" | "requested" | "not_found" | "error";
  origin?: string | undefined;
  remaining_secs?: number | undefined;
  error?: string | undefined;
};

type CloseOptions = {
  all?: boolean | undefined;
  cooperative?: boolean | undefined;
  finalize?: boolean | undefined;
  orphaned?: boolean | undefined;
  target?: string | undefined;
  yes?: boolean | undefined;
};

type CloseSummaryOutput = {
  closed: number;
  pending: number;
  failed: number;
  results: CloseResultRecord[];
};

export async function dryRunCloseSessions({ network }: Wallet, options: CloseOptions) {
  validateCloseOptions(options);
  const targets = await closeTargets(options, network, { dryRun: true });
  // The close this reviews would read the channels, so refuse an RPC on another chain now.
  if (targets.some(hasChannel)) await requireRpcChain(network.chainId);
  return {
    targets: targets.map((record) => {
      if (!record.virtual) return closeTarget(record);
      if (record.channel_id) return { channel_id: record.channel_id };
      return { channel_id: "", origin: record.origin, state: "not found" };
    }),
    ...(targets.some(hasChannel)
      ? nextStep(
          `Review the sessions, then run the next command to ${options.finalize ? "withdraw" : "close"} them. This cannot be undone.`,
          confirmedCloseArgv(options),
          { network },
        )
      : {}),
  };
}

/**
 * Closes the selected sessions once the close is confirmed: `--yes` confirms it, a run that can
 * prompt asks on the terminal, and any other run sends nothing and is refused with the same
 * command plus `--yes`. Targets without a channel have nothing to close and need no confirmation.
 */
export async function closeSessions(
  { account, network, state }: Wallet,
  options: CloseOptions,
  context: CommandContext,
  { confirm = confirmPrompt }: { confirm?: (question: string) => Promise<boolean> } = {},
) {
  validateCloseOptions(options);
  const summary = closeSummary();
  const targets = await closeTargets(options, network, { walletChainId: storedChainId(state) });
  const closable = targets.filter(hasChannel);
  // Refused for every target at once, before the prompt, rather than as each one's error.
  if (closable.length > 0) await requireRpcChain(network.chainId);
  if (!options.yes && closable.length > 0) {
    if (context.agent) {
      const command = continuationCommand(confirmedCloseArgv(options), network);
      return context.error(
        commandError(
          "E_USAGE",
          `Closing a session cannot be undone, so it needs confirmation. Review the sessions with --dry-run, then run '${command}'.`,
          command,
        ),
      );
    }
    if (!(await confirm(closePrompt(closable, options, network))))
      throw usageError("Sessions not closed: not confirmed at the prompt");
  }
  for (const target of targets)
    await recordCloseResult(
      summary,
      closeOneSession(target, {
        cooperative: options.cooperative,
        finalize: options.finalize,
        from: account.address,
        network,
      }),
      target,
    );
  return options.cooperative
    ? withCloseConfirmationNextStep(summary, network)
    : withPendingCloseNextStep(summary, network, targets);
}

/**
 * Points cooperative closes the chain does not show yet at a plain rerun, which removes the
 * record once the close is on-chain and otherwise requests the close on-chain itself. The rerun
 * carries `--yes`, since this run already confirmed the close.
 */
function withCloseConfirmationNextStep(summary: CloseSummaryOutput, network: Network) {
  const requested = summary.results.filter((result) => result.status === "requested");
  if (requested.length === 0) return summary;
  const single = requested.length === 1 ? requested[0] : undefined;
  if (!single)
    return {
      ...summary,
      instruction: `${requested.length} cooperative closes were accepted by the server, but the chain does not show them closed yet, so their local records were kept. Confirm each with ${requested
        .map(
          (result) =>
            `'${continuationCommand(["wallet", "sessions", "close", result.channel_id, "--yes"], network)}'`,
        )
        .join(", ")}; a channel that is still open has its close requested on-chain instead.`,
    };
  return {
    ...summary,
    ...nextStep(
      `The server accepted the cooperative close of channel ${single.channel_id}, but the chain does not show it closed yet, so its local record was kept. Run the next command to confirm the close and remove the record; if the channel is still open, it requests the close on-chain instead.`,
      ["wallet", "sessions", "close", single.channel_id, "--yes"],
      { network, until: ".pending == 0 and .failed == 0" },
    ),
  };
}

/**
 * Points pending closes at a rerun of the same scope, which reports them as pending without a
 * transaction until the grace period ends and then withdraws exactly those channels. Each rerun
 * carries `--yes`, since this run already confirmed the close.
 */
function withPendingCloseNextStep(
  summary: CloseSummaryOutput,
  network: Network,
  targets: readonly ChannelRecord[],
) {
  const pending = summary.results.filter((result) => result.status === "pending");
  if (pending.length === 0) return summary;
  const waitSecs = Math.max(...pending.map((result) => result.remaining_secs ?? 0));
  const readyAt = formatUnixTimestamp(nowSeconds() + waitSecs);
  const single = pending.length === 1 ? pending[0] : undefined;
  const status = single
    ? `Close pending for channel ${single.channel_id}; its deposit can be withdrawn after ${readyAt} (in ${waitSecs}s).`
    : `${pending.length} session closes are pending; their deposits can be withdrawn after ${readyAt} (in ${waitSecs}s).`;
  // Discovered channels have no server to ask, and session servers refuse a cooperative close of
  // a precompile channel once its close is requested.
  const offersCooperative = (result: CloseResultRecord) =>
    targets.some(
      (record) =>
        record.channel_id === result.channel_id &&
        record.origin !== "" &&
        !isPrecompileEscrow(record.escrow_contract),
    );
  const cooperative =
    single && offersCooperative(single)
      ? ` To close it now through its server instead, run '${continuationCommand(["wallet", "sessions", "close", single.channel_id, "--cooperative", "--yes"], network)}'.`
      : !single && pending.some(offersCooperative)
        ? " To close one now through its server instead, add --cooperative to its command."
        : "";
  // Rerunning a broad scope (--all, an origin, or a state filter) could pick up channels opened
  // or closed since, so several pending channels are named one by one instead.
  if (!single)
    return {
      ...summary,
      instruction: `${status} Then withdraw each with ${pending
        .map(
          (result) =>
            `'${continuationCommand(["wallet", "sessions", "close", result.channel_id, "--yes"], network)}'`,
        )
        .join(", ")}.${cooperative}`,
    };
  return {
    ...summary,
    ...nextStep(
      `${status} Then run the next command; until then it reports the close as pending without sending a transaction.${cooperative}`,
      ["wallet", "sessions", "close", single.channel_id, "--yes"],
      {
        network,
        pollIntervalSeconds: waitSecs,
        until: ".pending == 0 and .failed == 0",
      },
    ),
  };
}

/** The `sessions close` command for `options`, confirmed with `--yes`. */
function confirmedCloseArgv(options: CloseOptions) {
  return [
    "wallet",
    "sessions",
    "close",
    ...(options.target ? [options.target] : []),
    ...(options.all ? ["--all"] : []),
    ...(options.orphaned ? ["--orphaned"] : []),
    ...(options.finalize ? ["--finalize"] : []),
    ...(options.cooperative ? ["--cooperative"] : []),
    "--yes",
  ];
}

/** Whether a close target names a channel; an origin without a session names none. */
function hasChannel(record: ChannelRecord) {
  return isChannelId(record.channel_id);
}

/** Asks to close `records` on `network`, listing each channel and the deposit it holds. */
function closePrompt(records: readonly ChannelRecord[], options: CloseOptions, network: Network) {
  const verb = options.finalize ? "Withdraw" : "Close";
  const outcome = options.finalize
    ? "Each withdrawal returns the channel's unspent deposit to the wallet."
    : options.cooperative
      ? "The session's server closes the channel now, and its unspent deposit returns to the wallet."
      : "Each close is requested on-chain; its unspent deposit returns to the wallet once withdrawn after the grace period.";
  const deposit = (record: ChannelRecord) =>
    // A channel ID without a local record is read on-chain only when it is closed.
    record.virtual
      ? "unknown (no local record)"
      : `${formatTokenUnits(record.deposit, tokenDecimals())} ${tokenSymbol(record.token, record.chain_id) ?? record.token}`;
  return [
    `${verb} ${records.length === 1 ? "1 session" : `${records.length} sessions`}${options.cooperative ? " through its server" : ""}:`,
    ...records.flatMap((record) => [
      `  - channel: ${record.channel_id}`,
      `    origin:  ${record.origin || "none"}`,
      `    network: ${network.name} (chain ${record.chain_id})`,
      `    deposit: ${deposit(record)}`,
    ]),
    outcome,
    `${verb} ${records.length === 1 ? "this session" : "these sessions"}? This cannot be undone.`,
  ].join("\n");
}

function validateCloseOptions(options: CloseOptions) {
  if (options.cooperative && (options.all || options.orphaned || options.finalize))
    throw usageError("--cooperative cannot be combined with --all, --orphaned, or --finalize");
  if (!options.target && !options.all && !options.orphaned && !options.finalize)
    throw usageError(
      "Specify a URL, channel ID (0x...), or use --all/--orphaned/--finalize to close sessions",
    );
}

/**
 * Selects the sessions a close acts on. A target selects its own sessions, also with `--finalize`,
 * so each one reports why it was or was not withdrawn. Otherwise the selected network is scanned,
 * and `--finalize` keeps only channels whose grace period has ended. `walletChainId`, the chain
 * the wallet is logged in on, is set when the close may send transactions.
 */
async function closeTargets(
  options: CloseOptions,
  network: Network,
  { dryRun = false, walletChainId }: { dryRun?: boolean; walletChainId?: number } = {},
) {
  if (options.target && !options.all && !options.orphaned)
    return targetRecords(
      options.target,
      await readChannelRecords(),
      network,
      [
        ...(options.finalize ? ["--finalize"] : []),
        ...(options.cooperative ? ["--cooperative"] : []),
        ...(dryRun ? ["--dry-run"] : []),
        // A confirmed close stays confirmed on the right network; an unconfirmed one still asks.
        ...(options.yes ? ["--yes"] : []),
      ],
      walletChainId,
    );

  const local = (await discoverAndPersistOrphanedChannels(network)).filter(
    (record) => record.chain_id === network.chainId,
  );
  const scoped =
    options.orphaned && !options.all
      ? local.filter((record) => sessionStatus(record) === "orphaned")
      : local;
  return options.finalize
    ? scoped.filter((record) => sessionStatus(record) === "finalizable")
    : scoped;
}

/**
 * The sessions a channel ID, origin, or URL names on `network`. A target whose sessions are all on
 * another network is refused before any on-chain read, since the selected chain says nothing
 * about a channel whose deposit is locked on another one. When the wallet is logged in on another
 * chain than the sessions, the refusal also names the login their transactions need.
 */
function targetRecords(
  target: string,
  records: ChannelRecord[],
  network: Network,
  modeFlags: readonly string[],
  walletChainId?: number,
) {
  const channelId = isChannelId(target) ? target.toLowerCase() : undefined;
  const origin = normalizeOrigin(target);
  const matches = records.filter((record) =>
    channelId ? record.channel_id === channelId : record.origin === origin,
  );
  const selected = matches.filter((record) => record.chain_id === network.chainId);
  if (selected.length > 0) return selected;

  const elsewhere = matches[0];
  if (elsewhere) {
    const sessionNetwork = parseNetwork(elsewhere.network);
    const rerun = continuationCommand(
      // Keep the requested mode so the rerun performs the same operation on the right network.
      ["wallet", "sessions", "close", target, ...modeFlags],
      sessionNetwork,
    );
    const location = `No session for ${target} on ${networkName(network.chainId)}; it is on ${elsewhere.network}`;
    if (walletChainId !== undefined && walletChainId !== elsewhere.chain_id)
      throw usageError(
        `${location}, where the wallet is not logged in. Run '${continuationCommand(["wallet", "login"], sessionNetwork)}', then rerun with '${rerun}'.`,
      );
    throw usageError(`${location}. Rerun with '${rerun}'.`);
  }
  return [
    channelId
      ? virtualChannelRecord({ channelId, chain: network.chainId })
      : virtualMissingChannelRecord({ origin: target, chain: network.chainId }),
  ];
}

async function closeOneSession(
  record: ChannelRecord,
  options: {
    cooperative?: boolean | undefined;
    finalize?: boolean | undefined;
    /** The logged-in wallet that sends the close transactions. */
    from: string;
    network: Network;
  },
): Promise<CloseResultRecord> {
  if (!isChannelId(record.channel_id))
    return {
      channel_id: record.channel_id,
      status: "error",
      origin: record.origin,
      error: "no active session",
    };

  const escrow = (record.escrow_contract || escrowContract(options.network.chainId)) as Address;
  const channelId = record.channel_id as Hex;
  const onChain = await getOnChainChannel({
    channelId,
    escrowContract: escrow,
    network: options.network,
  });
  // Only a channel the escrow reports as finalized proves the close; a missing one keeps its record.
  if (!onChain) {
    // The precompile clears a closed channel, whose ChannelClosed log can be past the scan depth.
    // A record whose close was requested saw the channel open on this chain, so for it the
    // cleared state means the channel closed, not that it never existed.
    const closeRequested =
      record.close_requested_at > 0 || record.state === "closing" || record.state === "finalizable";
    if (isPrecompileEscrow(escrow) && closeRequested) {
      await deleteChannelRecord(record.channel_id);
      return closeResult(record, "closed");
    }
    return closeResult(record, "not_found", {
      error: record.virtual
        ? `channel not found on ${networkName(options.network.chainId)}`
        : `channel not found on ${networkName(options.network.chainId)}; kept the local session record (if the channel was already closed, '${continuationCommand(["wallet", "sessions", "sync"], options.network)}' removes it)`,
    });
  }
  if (onChain.finalized) {
    await deleteChannelRecord(record.channel_id);
    return closeResult(record, "closed");
  }

  const gracePeriod = await readGracePeriod({ escrowContract: escrow, network: options.network });
  const closeRequestedAt = Number(onChain.closeRequestedAt);
  const now = nowSeconds();

  if (options.finalize && closeRequestedAt === 0)
    return closeResult(record, "error", {
      error: `close not requested; request it with '${continuationCommand(["wallet", "sessions", "close", record.channel_id], options.network)}'`,
    });

  if (options.cooperative) {
    await closeSessionCooperatively({
      channelId,
      escrowContract: escrow,
      network: options.network,
      record,
    });
    // The server's response is not proof: the record, and a v2 descriptor needed to withdraw,
    // stay until the chain shows the close.
    const closed = await getOnChainChannel({
      channelId,
      escrowContract: escrow,
      network: options.network,
    });
    if (!closed?.finalized) {
      // Marked closing, the channel is no longer reused, so a later payment to the same service
      // opens a new channel instead of signing a higher voucher on this one. Only an on-chain
      // close request starts a grace period.
      await updateChannelCloseState({
        channelId: record.channel_id,
        closeRequestedAt: closeRequestedAt || now,
        graceReadyAt: closeRequestedAt ? closeRequestedAt + gracePeriod : 0,
        state: "closing",
      });
      return closeResult(record, "requested");
    }
    await deleteChannelRecord(record.channel_id);
    return closeResult(record, "closed");
  }

  if (closeRequestedAt === 0) {
    await sendSessionManagementTransaction({
      channelId,
      escrowContract: escrow,
      from: options.from,
      functionName: "requestClose",
      network: options.network,
      record,
    });
    await updateChannelCloseState({
      channelId: record.channel_id,
      closeRequestedAt: now,
      graceReadyAt: now + gracePeriod,
      state: "closing",
    });
    return closeResult(record, "pending", { remaining_secs: gracePeriod });
  }

  const readyAt = closeRequestedAt + gracePeriod;
  if (now < readyAt) {
    await updateChannelCloseState({
      channelId: record.channel_id,
      closeRequestedAt,
      graceReadyAt: readyAt,
      state: "closing",
    });
    return closeResult(record, "pending", { remaining_secs: readyAt - now });
  }

  await sendSessionManagementTransaction({
    channelId,
    escrowContract: escrow,
    from: options.from,
    functionName: "withdraw",
    network: options.network,
    record,
  });
  await deleteChannelRecord(record.channel_id);
  return closeResult(record, "closed");
}

async function closeSessionCooperatively(options: {
  channelId: Hex;
  escrowContract: Address;
  network: Network;
  record: ChannelRecord;
}) {
  const closeUrl = options.record.request_url || options.record.origin;
  if (!closeUrl)
    throw walletError({
      code: "E_NOT_FOUND",
      message: "cooperative close requires the original session request URL",
    });

  const chain = options.network.chainId;
  const challenge =
    (await refreshSessionChallenge(closeUrl)) ?? storedSessionChallenge(options.record);
  if (!challenge)
    throw paymentError("cooperative close requires a stored or fresh session payment challenge");

  const cumulativeAmount =
    options.record.accepted_cumulative > 0n
      ? options.record.accepted_cumulative
      : options.record.cumulative_amount;
  const signer = await sessionVoucherSigner(options.record);
  const signature = await signSessionVoucher({
    chain,
    channelId: options.channelId,
    cumulativeAmount,
    escrowContract: options.escrowContract,
    privateKey: signer.privateKey as Hex,
  });
  const authorization = Credential.serialize({
    challenge,
    payload: {
      action: "close",
      channelId: options.channelId,
      cumulativeAmount: cumulativeAmount.toString(),
      signature,
    },
    source: credentialSource(options.record.payer, chain),
  });

  const response = await fetch(closeUrl, {
    method: "POST",
    headers: { Authorization: authorization },
  });
  if (!response.ok) {
    const body = sanitizeText(await response.text().catch(() => ""));
    throw walletError({
      code: "E_HTTP",
      message: body.trim() || `cooperative close failed with HTTP ${response.status}`,
    });
  }
}

async function sessionVoucherSigner(record: ChannelRecord) {
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const expected = record.authorized_signer.toLowerCase();
  const key = state.accessKeys.find((candidate) => {
    if (candidate.chainId !== record.chain_id || !candidate.privateKey) return false;
    if (expected && expected !== "0x0000000000000000000000000000000000000000")
      return candidate.address.toLowerCase() === expected;
    return candidate.access.toLowerCase() === activeAccount?.address.toLowerCase();
  });
  if (!key)
    throw walletError({
      code: "E_NOT_FOUND",
      message: "cooperative close requires a local secp256k1 session access key",
    });
  if (key.keyType && key.keyType !== "secp256k1")
    throw usageError("session close vouchers require a secp256k1 access key");
  return key;
}

async function refreshSessionChallenge(url: string) {
  try {
    const response = await fetch(url, { method: "POST" });
    if (response.status !== 402) return null;
    const header = response.headers.get("www-authenticate");
    if (!header) return null;
    return Challenge.deserializeList(header).find(isSessionChallenge) ?? null;
  } catch {
    return null;
  }
}

function storedSessionChallenge(record: ChannelRecord) {
  try {
    const raw = JSON.parse(record.challenge_echo || "{}") as unknown;
    const value = getRecord(raw);
    const request =
      typeof value.request === "string"
        ? decodeBase64UrlJson(value.request)
        : getRecord(value.request);
    return Challenge.Schema.parse({
      id: stringValue(value.id),
      realm: stringValue(value.realm),
      method: stringValue(value.method),
      intent: stringValue(value.intent),
      request,
      ...(typeof value.expires === "string" ? { expires: value.expires } : {}),
      ...(typeof value.digest === "string" ? { digest: value.digest } : {}),
      ...(typeof value.opaque === "string" ? { opaque: value.opaque } : {}),
    });
  } catch {
    return null;
  }
}

function isSessionChallenge(challenge: Challenge.Challenge) {
  return challenge.method === "tempo" && challenge.intent === "session";
}

async function signSessionVoucher(options: {
  chain: number;
  channelId: Hex;
  cumulativeAmount: bigint;
  escrowContract: Address;
  privateKey: Hex;
}) {
  const typedData = {
    domain: {
      name: "Tempo Stream Channel",
      version: "1",
      chainId: options.chain,
      verifyingContract: options.escrowContract,
    },
    types: {
      Voucher: [
        { name: "channelId", type: "bytes32" },
        { name: "cumulativeAmount", type: "uint128" },
      ],
    },
    primaryType: "Voucher",
    message: {
      channelId: options.channelId,
      cumulativeAmount: options.cumulativeAmount,
    },
  } as const;
  const account = privateKeyToAccount(options.privateKey);
  return account.signTypedData(typedData);
}

function credentialSource(payer: string, chain: number) {
  if (payer.startsWith("did:pkh:eip155:")) return payer;
  return `did:pkh:eip155:${chain}:${payer}`;
}

async function sendSessionManagementTransaction(options: {
  channelId: Hex;
  escrowContract: Address;
  from: string;
  functionName: "requestClose" | "withdraw";
  network: Network;
  record: ChannelRecord;
}) {
  // The provider signs through the wallet's login, which is for one chain; a session on another
  // chain needs a login there, or its transaction could go to the wrong chain.
  const walletChainId = storedChainId(await loadWalletState());
  if (walletChainId !== options.record.chain_id)
    throw usageError(
      `wallet is logged in on ${networkName(walletChainId)}, not ${networkName(options.record.chain_id)}; log in with '${continuationCommand(["wallet", "login"], options.network)}', then rerun the close`,
    );

  const provider = await createProvider({ network: options.network });
  const request = buildSessionManagementTransactionRequest(options);
  const receipt = await provider.request({
    method: "eth_sendTransactionSync",
    params: [{ ...request, from: requireSender(provider, options.from) }],
  });
  const record = getRecord(receipt);
  const txHash = stringValue(record.transactionHash ?? record.transaction_hash ?? record.hash);
  if (!txHash)
    throw paymentOutcomeUnknownError(
      `${options.functionName} submitted but receipt did not include a transaction hash; check 'tempo wallet sessions list' before retrying.`,
    );
  // A reverted transaction still returns its receipt, so only a successful one may change the record.
  const status = stringValue(record.status);
  if (status !== "0x1" && status !== "success")
    throw paymentError(
      `${options.functionName} transaction ${txHash} did not succeed (receipt status ${status || "missing"}); the session record was kept`,
    );
  return txHash;
}

export function buildSessionManagementTransactionRequest(options: {
  channelId: Hex;
  escrowContract: Address;
  functionName: "requestClose" | "withdraw";
  record: ChannelRecord;
}) {
  const isPrecompile = isPrecompileEscrow(options.escrowContract);
  const descriptor = isPrecompile ? requireSessionDescriptor(options.record) : undefined;
  return {
    chainId: toHex(options.record.chain_id),
    feeToken: options.record.token as Address,
    calls: [
      {
        to: options.escrowContract,
        data: encodeFunctionData({
          abi: isPrecompile ? TempoAbis.tip20ChannelReserve : escrowAbi,
          functionName: options.functionName,
          args: isPrecompile ? [descriptor] : [options.channelId],
        } as never),
      },
    ],
  };
}

async function recordCloseResult(
  summary: CloseSummaryOutput,
  operation: Promise<CloseResultRecord>,
  target: ChannelRecord,
) {
  try {
    const result = await operation;
    summary.results.push(result);
    if (result.status === "closed") summary.closed += 1;
    else if (result.status === "pending" || result.status === "requested") summary.pending += 1;
    else summary.failed += 1;
  } catch (error) {
    summary.failed += 1;
    summary.results.push(
      closeResult(target, "error", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function closeSummary(): CloseSummaryOutput {
  return { closed: 0, pending: 0, failed: 0, results: [] };
}

function closeResult(
  record: ChannelRecord,
  status: CloseResultRecord["status"],
  extra: { remaining_secs?: number | undefined; error?: string | undefined } = {},
): CloseResultRecord {
  return {
    channel_id: record.channel_id,
    status,
    ...(record.origin ? { origin: record.origin } : {}),
    ...(extra.remaining_secs !== undefined ? { remaining_secs: extra.remaining_secs } : {}),
    ...(extra.error ? { error: extra.error } : {}),
  };
}

function virtualChannelRecord(options: { channelId: string; chain: number }): ChannelRecord {
  return {
    channel_id: options.channelId,
    network: networkName(options.chain),
    origin: "",
    request_url: "",
    chain_id: options.chain,
    escrow_contract: escrowContract(options.chain),
    payer: "",
    authorized_signer: "0x0000000000000000000000000000000000000000",
    token: tokenAddress(options.chain),
    deposit: 0n,
    cumulative_amount: 0n,
    accepted_cumulative: 0n,
    challenge_echo: "{}",
    session_protocol: "v1",
    state: "orphaned",
    close_requested_at: 0,
    grace_ready_at: 0,
    created_at: 0,
    last_used_at: 0,
    virtual: true,
  };
}

function virtualMissingChannelRecord(options: { origin: string; chain: number }): ChannelRecord {
  return {
    ...virtualChannelRecord({ channelId: "", chain: options.chain }),
    origin: options.origin,
  };
}

function closeTarget(record: ChannelRecord) {
  return {
    channel_id: record.channel_id,
    origin: record.origin,
    state: capitalizedState(sessionStatus(record)),
  };
}

function capitalizedState(value: ChannelState) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
