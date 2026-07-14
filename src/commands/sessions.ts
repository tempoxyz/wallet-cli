import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { encodeFunctionData, getAddress, parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Abis as TempoAbis, Channel as TempoChannel } from "viem/tempo";
import { Challenge, Credential } from "mppx";

import {
  defaultGracePeriodSeconds,
  escrowAbi,
  logHeadMargin,
  logQueryBlockRange,
  logScanDepth,
} from "../shared/constants.js";
import { usageError } from "../shared/errors.js";
import {
  chainId,
  createTempoPublicClient,
  escrowContract,
  networkName,
  tokenAddress,
  tokenDecimals,
  tokenSymbol,
} from "../shared/network.js";
import { channelsDbPath, runProcess, runSql, sqlString } from "../shared/process.js";
import {
  decodeBase64UrlJson,
  formatTokenUnits,
  formatUnixTimestamp,
  getArray,
  getRecord,
  isChannelId,
  normalizeOrigin,
  nowSeconds,
  parseOnChainBigInt,
  parseStoredBigInt,
  safeNumber,
  stringValue,
} from "../shared/utils.js";
import { createProvider } from "../provider.js";
import { requireSessionDescriptor } from "../payment/session-descriptor.js";
import { loadWalletState } from "../wallet/store.js";

export type ChannelState = "active" | "closing" | "finalizable" | "finalized" | "orphaned";

export type ChannelRecord = {
  channel_id: string;
  network: string;
  origin: string;
  request_url: string;
  chain_id: number;
  escrow_contract: string;
  payer: string;
  authorized_signer: string;
  token: string;
  deposit: bigint;
  cumulative_amount: bigint;
  accepted_cumulative: bigint;
  challenge_echo: string;
  session_protocol: string;
  descriptor_json?: string | undefined;
  state: ChannelState;
  close_requested_at: number;
  grace_ready_at: number;
  created_at: number;
  last_used_at: number;
  virtual?: boolean | undefined;
};

type OnChainDiscoveredChannel = {
  channelId: string;
  escrowContract: Address;
  token: Address;
  deposit: bigint;
  settled: bigint;
  closeRequestedAt: bigint;
};

type CloseResultRecord = {
  channel_id: string;
  status: "closed" | "pending" | "error";
  origin?: string | undefined;
  remaining_secs?: number | undefined;
  error?: string | undefined;
};

type CloseSummaryOutput = {
  closed: number;
  pending: number;
  failed: number;
  results: CloseResultRecord[];
};

export async function listSessions(
  options: {
    all?: boolean | undefined;
    network?: string | undefined;
    orphaned?: boolean | undefined;
  } = {},
) {
  const network = networkName(chainId(options.network)) ?? "tempo";
  const records =
    options.all || options.orphaned
      ? await discoverAndPersistOrphanedChannels({ network: options.network })
      : await readChannelRecords();
  const sessions = records
    .filter((record) => record.network === network)
    .map(sessionItem)
    .filter((record) => record.status !== "finalized")
    .filter((record) => (options.orphaned && !options.all ? record.status === "orphaned" : true));

  return {
    sessions,
    total: sessions.length,
  };
}

export async function syncSessions(options: {
  network?: string | undefined;
  origin?: string | undefined;
}) {
  const chain = chainId(options.network);
  const network = networkName(chain) ?? "tempo";
  const records = (await readChannelRecords()).filter((record) => record.network === network);
  const selected = options.origin
    ? records.filter((record) => record.origin === normalizeOrigin(options.origin ?? ""))
    : records;

  for (const record of selected) {
    const onChain = await getOnChainChannel({
      channelId: record.channel_id as Hex,
      escrowContract: (record.escrow_contract || escrowContract(chain)) as Address,
      network: options.network,
    });
    if (!onChain) {
      await deleteChannelRecord(record.channel_id);
      continue;
    }

    if (onChain.closeRequestedAt > 0n) {
      const gracePeriod = await readGracePeriod({
        escrowContract: (record.escrow_contract || escrowContract(chain)) as Address,
        network: options.network,
      });
      await updateChannelCloseState({
        channelId: record.channel_id,
        closeRequestedAt: Number(onChain.closeRequestedAt),
        graceReadyAt: Number(onChain.closeRequestedAt + BigInt(gracePeriod)),
        state: sessionStateFromCloseTiming(Number(onChain.closeRequestedAt), gracePeriod),
      });
    }
  }

  return listSessions({ network: options.network });
}

export async function dryRunCloseSessions(options: {
  all?: boolean | undefined;
  cooperative?: boolean | undefined;
  finalize?: boolean | undefined;
  network?: string | undefined;
  orphaned?: boolean | undefined;
  target?: string | undefined;
}) {
  validateCooperativeCloseOptions(options);
  const records =
    options.all || options.orphaned
      ? await discoverAndPersistOrphanedChannels({ network: options.network })
      : await readChannelRecords();
  const network = networkName(chainId(options.network)) ?? "tempo";
  const local = records.filter((record) => record.network === network);

  if (options.all) {
    return {
      targets: local.map((record) => closeTarget(record)),
    };
  }

  if (options.finalize) {
    return {
      targets: local
        .filter((record) => sessionStatus(record) === "finalizable")
        .map((record) => ({ ...closeTarget(record), state: "Finalizable" })),
    };
  }

  if (options.orphaned) {
    return {
      targets: local.filter((record) => sessionStatus(record) === "orphaned").map(closeTarget),
    };
  }

  if (options.target) {
    if (isChannelId(options.target)) {
      return { targets: [{ channel_id: options.target }] };
    }

    const origin = normalizeOrigin(options.target);
    const matches = local.filter((record) => record.origin === origin);
    if (matches.length === 0) {
      return {
        targets: [
          {
            channel_id: "",
            origin: options.target,
            state: "not found",
          },
        ],
      };
    }
    return { targets: matches.map(closeTarget) };
  }

  throw usageError(
    "Specify a URL, channel ID (0x...), or use --all/--orphaned/--finalize to close sessions",
  );
}

export async function closeSessions(options: {
  all?: boolean | undefined;
  cooperative?: boolean | undefined;
  finalize?: boolean | undefined;
  network?: string | undefined;
  orphaned?: boolean | undefined;
  target?: string | undefined;
}) {
  validateCooperativeCloseOptions(options);
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  if (!activeAccount) throw new Error("No wallet is logged in");

  if (!options.target && !options.all && !options.orphaned && !options.finalize)
    throw usageError(
      "Specify a URL, channel ID (0x...), or use --all/--orphaned/--finalize to close sessions",
    );

  const summary = closeSummary();
  const targets = await closeTargets(options);

  if (options.finalize) {
    for (const target of targets.filter((target) => closeTargetState(target) === "finalizable"))
      await recordCloseResult(
        summary,
        closeOneSession(target, { finalize: true, network: options.network }),
        target,
      );
    return summary;
  }

  for (const target of targets)
    await recordCloseResult(
      summary,
      closeOneSession(target, { cooperative: options.cooperative, network: options.network }),
      target,
    );
  return summary;
}

function validateCooperativeCloseOptions(options: {
  all?: boolean | undefined;
  cooperative?: boolean | undefined;
  finalize?: boolean | undefined;
  orphaned?: boolean | undefined;
}) {
  if (options.cooperative && (options.all || options.orphaned || options.finalize))
    throw usageError("--cooperative cannot be combined with --all, --orphaned, or --finalize");
}

async function closeTargets(options: {
  all?: boolean | undefined;
  finalize?: boolean | undefined;
  network?: string | undefined;
  orphaned?: boolean | undefined;
  target?: string | undefined;
}) {
  const chain = chainId(options.network);
  const network = networkName(chain) ?? "tempo";
  const records =
    options.all || options.orphaned || options.finalize
      ? await discoverAndPersistOrphanedChannels({ network: options.network })
      : await readChannelRecords();
  const local = records.filter((record) => record.network === network);

  if (options.all) return local;
  if (options.orphaned) return local.filter((record) => sessionStatus(record) === "orphaned");
  if (options.finalize) return local.filter((record) => sessionStatus(record) === "finalizable");

  if (options.target && isChannelId(options.target)) {
    const localTarget = local.find((record) => record.channel_id === options.target?.toLowerCase());
    return localTarget
      ? [localTarget]
      : [virtualChannelRecord({ channelId: options.target.toLowerCase(), chain })];
  }

  if (options.target) {
    const origin = normalizeOrigin(options.target);
    const matches = local.filter((record) => record.origin === origin);
    if (matches.length === 0)
      return [virtualMissingChannelRecord({ origin: options.target, chain })];
    return matches;
  }

  return [];
}

async function closeOneSession(
  record: ChannelRecord,
  options: {
    cooperative?: boolean | undefined;
    finalize?: boolean | undefined;
    network?: string | undefined;
  },
): Promise<CloseResultRecord> {
  if (!isChannelId(record.channel_id))
    return {
      channel_id: record.channel_id,
      status: "error",
      origin: record.origin,
      error: "no active session",
    };

  const chain = chainId(options.network);
  const escrow = (record.escrow_contract || escrowContract(chain)) as Address;
  const channelId = record.channel_id as Hex;
  const onChain = await getOnChainChannel({
    channelId,
    escrowContract: escrow,
    network: options.network,
  });
  if (!onChain) {
    await deleteChannelRecord(record.channel_id);
    return closeResult(record, "closed");
  }

  const gracePeriod = await readGracePeriod({ escrowContract: escrow, network: options.network });
  const closeRequestedAt = Number(onChain.closeRequestedAt);
  const now = nowSeconds();

  if (options.cooperative) {
    await closeSessionCooperatively({
      channelId,
      escrowContract: escrow,
      network: options.network,
      record,
    });
    await deleteChannelRecord(record.channel_id);
    return closeResult(record, "closed");
  }

  if (closeRequestedAt === 0) {
    await sendSessionManagementTransaction({
      channelId,
      escrowContract: escrow,
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
  network?: string | undefined;
  record: ChannelRecord;
}) {
  const closeUrl = options.record.request_url || options.record.origin;
  if (!closeUrl) throw new Error("cooperative close requires the original session request URL");

  const chain = chainId(options.network);
  const challenge =
    (await refreshSessionChallenge(closeUrl)) ?? storedSessionChallenge(options.record);
  if (!challenge)
    throw new Error("cooperative close requires a stored or fresh session payment challenge");

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
    const body = await response.text().catch(() => "");
    throw new Error(body.trim() || `cooperative close failed with HTTP ${response.status}`);
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
  if (!key) throw new Error("cooperative close requires a local secp256k1 session access key");
  if (key.keyType && key.keyType !== "secp256k1")
    throw new Error("session close vouchers require a secp256k1 access key");
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
  functionName: "requestClose" | "withdraw";
  network?: string | undefined;
  record: ChannelRecord;
}) {
  const provider = createProvider({ network: options.network });
  const request = buildSessionManagementTransactionRequest(options);
  const receipt = await provider.request({
    method: "eth_sendTransactionSync",
    params: [request],
  });
  const record = getRecord(receipt);
  const txHash = stringValue(record.transactionHash ?? record.transaction_hash ?? record.hash);
  if (!txHash)
    throw new Error(
      `${options.functionName} submitted but receipt did not include a transaction hash`,
    );
  return txHash;
}

export function buildSessionManagementTransactionRequest(options: {
  channelId: Hex;
  escrowContract: Address;
  functionName: "requestClose" | "withdraw";
  record: ChannelRecord;
}) {
  const isPrecompile = options.escrowContract.toLowerCase() === TempoChannel.address.toLowerCase();
  const descriptor = isPrecompile ? requireSessionDescriptor(options.record) : undefined;
  return {
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
    else if (result.status === "pending") summary.pending += 1;
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

function closeTargetState(record: ChannelRecord) {
  return sessionStatus(record);
}

function virtualChannelRecord(options: { channelId: string; chain: number }): ChannelRecord {
  return {
    channel_id: options.channelId,
    network: networkName(options.chain) ?? `chain-${options.chain}`,
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
    state: capitalizedState(record.state),
  };
}

function sessionItem(record: ChannelRecord) {
  const spent =
    record.accepted_cumulative > 0n ? record.accepted_cumulative : record.cumulative_amount;
  const remaining = record.deposit > spent ? record.deposit - spent : 0n;
  const status = sessionStatus(record);
  return {
    channel_id: record.channel_id,
    network: record.network,
    origin: record.origin,
    symbol: tokenSymbol(record.token),
    deposit: formatTokenUnits(record.deposit, tokenDecimals()),
    spent: formatTokenUnits(spent, tokenDecimals()),
    remaining: formatTokenUnits(remaining, tokenDecimals()),
    status,
    ...(status === "closing" || status === "finalizable"
      ? {
          remaining_secs:
            record.grace_ready_at > nowSeconds() ? record.grace_ready_at - nowSeconds() : 0,
        }
      : {}),
    created_at: formatUnixTimestamp(record.created_at),
    last_used_at: formatUnixTimestamp(record.last_used_at),
  };
}

async function readChannelRecords(): Promise<ChannelRecord[]> {
  const path = channelsDbPath();
  await ensureChannelsTable();
  const query = `SELECT version, origin, request_url, chain_id,
                    escrow_contract, token, payee, payer, authorized_signer,
                    salt, channel_id, session_protocol, descriptor_json, deposit, cumulative_amount, accepted_cumulative,
                    challenge_echo, state, close_requested_at, grace_ready_at, created_at, last_used_at,
                    server_spent
             FROM channels
             WHERE origin <> 'http://127.0.0.1'
             ORDER BY last_used_at DESC`;

  let stdout: string;
  try {
    stdout = await runProcess("sqlite3", ["-json", path, query]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("unable to open database file") || message.includes("no such table"))
      return [];
    throw error;
  }
  const rows = JSON.parse(stdout || "[]") as unknown;
  return getArray(rows).flatMap((row) => {
    const item = getRecord(row);
    const channelId = stringValue(item.channel_id).toLowerCase();
    const chain = typeof item.chain_id === "number" ? item.chain_id : Number(item.chain_id);
    const token = stringValue(item.token).toLowerCase();
    if (!isChannelId(channelId) || !Number.isFinite(chain) || !token) return [];
    return [
      {
        channel_id: channelId,
        network: networkName(chain) ?? `chain-${chain}`,
        origin: stringValue(item.origin),
        request_url: stringValue(item.request_url),
        chain_id: chain,
        escrow_contract: stringValue(item.escrow_contract).toLowerCase(),
        payer: stringValue(item.payer).toLowerCase(),
        authorized_signer: stringValue(item.authorized_signer).toLowerCase(),
        token,
        deposit: parseStoredBigInt(item.deposit),
        cumulative_amount: parseStoredBigInt(item.cumulative_amount),
        accepted_cumulative: parseStoredBigInt(item.accepted_cumulative),
        challenge_echo: stringValue(item.challenge_echo),
        session_protocol: stringValue(item.session_protocol) || "v1",
        descriptor_json: stringValue(item.descriptor_json) || undefined,
        state: channelState(stringValue(item.state)),
        close_requested_at: safeNumber(item.close_requested_at),
        grace_ready_at: safeNumber(item.grace_ready_at),
        created_at: safeNumber(item.created_at),
        last_used_at: safeNumber(item.last_used_at),
      },
    ];
  });
}

async function discoverAndPersistOrphanedChannels(options: { network?: string | undefined }) {
  const records = await readChannelRecords();
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const wallet = activeAccount?.address;
  if (!wallet) return records;

  const chain = chainId(options.network);
  const network = networkName(chain) ?? "tempo";
  const localIds = new Set(
    records.filter((record) => record.network === network).map((record) => record.channel_id),
  );
  const discovered = await findAllChannelsForPayer({
    network: options.network,
    payer: wallet as Address,
  });

  for (const channel of discovered) {
    if (localIds.has(channel.channelId.toLowerCase())) continue;
    const gracePeriod = await readGracePeriod({
      escrowContract: channel.escrowContract,
      network: options.network,
    });
    await saveDiscoveredChannel({
      channel,
      chainId: chain,
      gracePeriod,
      payer: wallet,
      state: sessionStateFromCloseTiming(Number(channel.closeRequestedAt), gracePeriod),
    });
  }

  return readChannelRecords();
}

async function findAllChannelsForPayer(options: { network?: string | undefined; payer: Address }) {
  const chain = chainId(options.network);
  const publicClient = createTempoPublicClient(options.network);
  const latest = (await publicClient.getBlockNumber()).valueOf() - logHeadMargin;
  const earliest = latest > logScanDepth ? latest - logScanDepth : 0n;
  const escrow = escrowContract(chain);
  const results: OnChainDiscoveredChannel[] = [];
  const event = parseAbiItem(
    "event ChannelOpened(bytes32 indexed channelId, address indexed payer, address indexed payee, address token, address authorizedSigner, bytes32 salt, uint256 deposit)",
  );

  let end = latest;
  while (end >= earliest) {
    const start = end > earliest + logQueryBlockRange ? end - logQueryBlockRange : earliest;
    const logs = await publicClient.getLogs({
      address: escrow,
      event,
      args: { payer: getAddress(options.payer) },
      fromBlock: start,
      toBlock: end,
    });

    for (const log of logs) {
      const channelId = log.args.channelId?.toLowerCase();
      if (!channelId || results.some((result) => result.channelId === channelId)) continue;
      const onChain = await getOnChainChannel({
        channelId: channelId as Hex,
        escrowContract: escrow,
        network: options.network,
      });
      if (!onChain) continue;
      results.push({
        channelId,
        escrowContract: escrow,
        token: onChain.token,
        deposit: onChain.deposit,
        settled: onChain.settled,
        closeRequestedAt: onChain.closeRequestedAt,
      });
    }

    if (start === earliest) break;
    end = start - 1n;
  }

  return results;
}

async function getOnChainChannel(options: {
  channelId: Hex;
  escrowContract: Address;
  network?: string | undefined;
}) {
  if (options.escrowContract.toLowerCase() === TempoChannel.address.toLowerCase()) {
    const state = (await createTempoPublicClient(options.network).readContract({
      address: TempoChannel.address,
      abi: TempoAbis.tip20ChannelReserve,
      functionName: "getChannelState",
      args: [options.channelId],
    })) as unknown;
    const record = getRecord(state);
    const tuple = Array.isArray(state) ? state : [];
    const deposit = parseOnChainBigInt(record.deposit ?? tuple[1]);
    const settled = parseOnChainBigInt(record.settled ?? tuple[0]);
    const closeRequestedAt = parseOnChainBigInt(record.closeRequestedAt ?? tuple[2]);
    if (deposit === 0n) return null;
    return { token: tokenAddress(chainId(options.network)), deposit, settled, closeRequestedAt };
  }

  const value = (await createTempoPublicClient(options.network).readContract({
    address: options.escrowContract,
    abi: escrowAbi,
    functionName: "getChannel",
    args: [options.channelId],
  })) as unknown;
  const record = getRecord(value);
  const tuple = Array.isArray(value) ? value : [];
  const finalized = Boolean(record.finalized ?? tuple[0]);
  const closeRequestedAt = parseOnChainBigInt(record.closeRequestedAt ?? tuple[1]);
  const token = stringValue(record.token ?? tuple[4]).toLowerCase() as Address;
  const deposit = parseOnChainBigInt(record.deposit ?? tuple[6]);
  const settled = parseOnChainBigInt(record.settled ?? tuple[7]);
  if (finalized || deposit === 0n) return null;
  return { token, deposit, settled, closeRequestedAt };
}

async function readGracePeriod(options: { escrowContract: Address; network?: string | undefined }) {
  try {
    const value = (await createTempoPublicClient(options.network).readContract({
      address: options.escrowContract,
      abi: escrowAbi,
      functionName: "CLOSE_GRACE_PERIOD",
      args: [],
    })) as unknown;
    const grace = parseOnChainBigInt(value);
    if (grace > 0n && grace <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(grace);
  } catch {
    // Match the current wallet: grace-period lookup failure falls back to the protocol default.
  }
  return defaultGracePeriodSeconds;
}

async function saveDiscoveredChannel(options: {
  channel: OnChainDiscoveredChannel;
  chainId: number;
  gracePeriod: number;
  payer: string;
  state: ChannelState;
}) {
  const now = nowSeconds();
  const graceReadyAt =
    options.channel.closeRequestedAt === 0n
      ? 0
      : Number(options.channel.closeRequestedAt) + options.gracePeriod;
  await ensureChannelsTable();
  await runSql(`INSERT OR REPLACE INTO channels (
    channel_id, version, origin, request_url, chain_id, escrow_contract, token, payee, payer,
    authorized_signer, salt, deposit, cumulative_amount, accepted_cumulative, server_spent,
    challenge_echo, state, close_requested_at, grace_ready_at, created_at, last_used_at,
    session_protocol, descriptor_json
  ) VALUES (
    ${sqlString(options.channel.channelId)}, 1, '', '', ${options.chainId},
    ${sqlString(options.channel.escrowContract)}, ${sqlString(options.channel.token)},
    '0x0000000000000000000000000000000000000000', ${sqlString(options.payer.toLowerCase())},
    '0x0000000000000000000000000000000000000000', '0x00',
    ${sqlString(options.channel.deposit.toString())}, ${sqlString(options.channel.settled.toString())},
    ${sqlString(options.channel.settled.toString())}, '0', '{}', ${sqlString(options.state)},
    ${Number(options.channel.closeRequestedAt)}, ${graceReadyAt}, ${now}, ${now}, 'v1', NULL
  )`);
}

async function deleteChannelRecord(channelId: string) {
  await runSql(`DELETE FROM channels WHERE channel_id = ${sqlString(channelId)}`);
}

async function updateChannelCloseState(options: {
  channelId: string;
  state: ChannelState;
  closeRequestedAt: number;
  graceReadyAt: number;
}) {
  await runSql(`UPDATE channels SET
    state = ${sqlString(options.state)},
    close_requested_at = ${options.closeRequestedAt},
    grace_ready_at = ${options.graceReadyAt}
    WHERE channel_id = ${sqlString(options.channelId)}`);
}

async function ensureChannelsTable() {
  await mkdir(dirname(channelsDbPath()), { recursive: true });
  await runSql(`CREATE TABLE IF NOT EXISTS channels (
    channel_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    origin TEXT NOT NULL,
    request_url TEXT NOT NULL DEFAULT '',
    chain_id INTEGER NOT NULL,
    escrow_contract TEXT NOT NULL,
    token TEXT NOT NULL,
    payee TEXT NOT NULL,
    payer TEXT NOT NULL,
    authorized_signer TEXT NOT NULL,
    salt TEXT NOT NULL,
    deposit TEXT NOT NULL,
    cumulative_amount TEXT NOT NULL,
    challenge_echo TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active',
    close_requested_at INTEGER NOT NULL DEFAULT 0,
    grace_ready_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    accepted_cumulative TEXT NOT NULL DEFAULT '0',
    server_spent TEXT NOT NULL DEFAULT '0',
    session_protocol TEXT NOT NULL DEFAULT 'v1',
    descriptor_json TEXT
  )`);
  await addColumnIfMissing("accepted_cumulative TEXT NOT NULL DEFAULT '0'");
  await addColumnIfMissing("server_spent TEXT NOT NULL DEFAULT '0'");
  await addColumnIfMissing("session_protocol TEXT NOT NULL DEFAULT 'v1'");
  await addColumnIfMissing("descriptor_json TEXT");
}

async function addColumnIfMissing(definition: string) {
  await runSql(`ALTER TABLE channels ADD COLUMN ${definition}`).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate column name")) throw error;
  });
}

function sessionStateFromCloseTiming(closeRequestedAt: number, gracePeriod: number): ChannelState {
  if (closeRequestedAt === 0) return "orphaned";
  return closeRequestedAt + gracePeriod <= nowSeconds() ? "finalizable" : "closing";
}

function sessionStatus(record: ChannelRecord) {
  if (record.state === "closing") {
    return record.grace_ready_at > 0 && record.grace_ready_at <= nowSeconds()
      ? "finalizable"
      : "closing";
  }
  return record.state;
}

function channelState(value: string): ChannelState {
  if (
    value === "closing" ||
    value === "finalizable" ||
    value === "finalized" ||
    value === "orphaned"
  )
    return value;
  return "active";
}

function capitalizedState(value: ChannelState) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
