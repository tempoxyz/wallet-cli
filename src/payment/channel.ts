import { getAddress, parseAbiItem, type Address, type Hex } from "viem";
import { Abis as TempoAbis, Channel as TempoChannel } from "viem/tempo";

import {
  defaultGracePeriodSeconds,
  escrowAbi,
  logHeadMargin,
  logQueryBlockRange,
  logQueryConcurrency,
  logScanDepth,
  precompileChannelsFromBlock,
} from "../shared/constants.js";
import {
  createTempoPublicClient,
  escrowContract,
  requireRpcChain,
  tokenAddress,
  type Network,
} from "../shared/network.js";
import { getRecord, parseOnChainBigInt, stringValue } from "../shared/utils.js";
import type { SessionDescriptor } from "./session-descriptor.js";
import type { PersistedSessionRecord } from "./session-store.js";

type RpcOptions = Parameters<typeof createTempoPublicClient>[1];
type TempoPublicClient = ReturnType<typeof createTempoPublicClient>;

export type OnChainDiscoveredChannel = {
  channelId: string;
  escrowContract: Address;
  token: Address;
  deposit: bigint;
  settled: bigint;
  closeRequestedAt: bigint;
  /** A precompile channel's descriptor, which its `requestClose` and `withdraw` take. */
  descriptor?: SessionDescriptor | undefined;
};

export async function findAllChannelsForPayer(options: { network: Network; payer: Address }) {
  await requireRpcChain(options.network.chainId);
  const chain = options.network.chainId;
  const publicClient = createTempoPublicClient(chain);
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
      if (!onChain || onChain.finalized) continue;
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

const channelOpenedEvent = parseAbiItem(
  "event ChannelOpened(bytes32 indexed channelId, address indexed payer, address indexed payee, address operator, address token, address authorizedSigner, bytes32 salt, bytes32 expiringNonceHash, uint96 deposit)",
);

/**
 * The TIP-1034 precompile channels `payer` pays from, opened from `fromBlock` (else from the
 * precompile's first channel on the chain) up to the head by any client, that still hold a
 * deposit. Each carries the descriptor rebuilt from its ChannelOpened event. `scannedTo` is the
 * last block the scan covered, or undefined when there was no block to scan.
 */
export async function findPrecompileChannelsForPayer(options: {
  fromBlock?: bigint | undefined;
  network: Network;
  payer: Address;
}) {
  await requireRpcChain(options.network.chainId);
  const chain = options.network.chainId;
  const client = createTempoPublicClient(chain);
  const latest = (await client.getBlockNumber()).valueOf() - logHeadMargin;
  const earliest = options.fromBlock ?? precompileChannelsFromBlock[chain] ?? 0n;
  if (latest < earliest) return { channels: [], scannedTo: undefined };

  const ranges: [bigint, bigint][] = [];
  for (let start = earliest; start <= latest; start += logQueryBlockRange) {
    const end = start + logQueryBlockRange - 1n;
    ranges.push([start, end < latest ? end : latest]);
  }

  const channels: OnChainDiscoveredChannel[] = [];
  for (let index = 0; index < ranges.length; index += logQueryConcurrency) {
    const batches = await Promise.all(
      ranges
        .slice(index, index + logQueryConcurrency)
        .map(([fromBlock, toBlock]) =>
          precompileChannelsOpened(client, { fromBlock, payer: options.payer, toBlock }),
        ),
    );
    for (const channel of batches.flat())
      if (!channels.some((known) => known.channelId === channel.channelId)) channels.push(channel);
  }
  return { channels, scannedTo: latest };
}

/** The precompile channels `payer` opened in one block range that still hold a deposit. */
async function precompileChannelsOpened(
  client: TempoPublicClient,
  options: { fromBlock: bigint; payer: Address; toBlock: bigint },
) {
  const logs = await client.getLogs({
    address: TempoChannel.address,
    event: channelOpenedEvent,
    args: { payer: getAddress(options.payer) },
    fromBlock: options.fromBlock,
    toBlock: options.toBlock,
  });
  const opened = logs.flatMap((log) => {
    const { args } = log;
    if (
      !args.channelId ||
      !args.payer ||
      !args.payee ||
      !args.operator ||
      !args.token ||
      !args.authorizedSigner ||
      !args.salt ||
      !args.expiringNonceHash
    )
      return [];
    const descriptor: SessionDescriptor = {
      authorizedSigner: args.authorizedSigner,
      expiringNonceHash: args.expiringNonceHash,
      operator: args.operator,
      payee: args.payee,
      payer: args.payer,
      salt: args.salt,
      token: args.token,
    };
    return [{ channelId: args.channelId.toLowerCase() as Hex, descriptor }];
  });
  if (opened.length === 0) return [];

  const states = (await client.readContract({
    address: TempoChannel.address,
    abi: TempoAbis.tip20ChannelReserve,
    functionName: "getChannelStatesBatch",
    args: [opened.map((channel) => channel.channelId)],
  })) as unknown;
  const list = Array.isArray(states) ? (states as unknown[]) : [];
  return opened.flatMap(({ channelId, descriptor }, index): OnChainDiscoveredChannel[] => {
    const item = list[index];
    const state = getRecord(item);
    const tuple = Array.isArray(item) ? (item as unknown[]) : [];
    const deposit = parseOnChainBigInt(state.deposit ?? tuple[1]);
    // The precompile clears a closed channel to a zero deposit, so nothing is left to withdraw.
    if (deposit === 0n) return [];
    return [
      {
        channelId,
        escrowContract: TempoChannel.address,
        token: descriptor.token.toLowerCase() as Address,
        deposit,
        settled: parseOnChainBigInt(state.settled ?? tuple[0]),
        closeRequestedAt: parseOnChainBigInt(state.closeRequestedAt ?? tuple[2]),
        descriptor,
      },
    ];
  });
}

/**
 * The channel's escrow state on `network`, or null when the escrow has no such channel. Unlike
 * `readOnChainChannel`, a finalized channel is returned with `finalized` set.
 */
export async function getOnChainChannel(options: {
  channelId: Hex;
  escrowContract: Address;
  network: Network;
}) {
  await requireRpcChain(options.network.chainId);
  const client = createTempoPublicClient(options.network.chainId);
  if (isPrecompileEscrow(options.escrowContract)) {
    const { deposit, settled, closeRequestedAt } = await readPrecompileChannel(
      client,
      options.channelId,
    );
    // The precompile clears a closed channel's state, so only its ChannelClosed event tells a
    // closed channel from one that never existed.
    if (deposit === 0n && !(await precompileChannelClosed(options.channelId, options.network)))
      return null;
    return {
      finalized: deposit === 0n,
      token: tokenAddress(options.network.chainId),
      deposit,
      settled,
      closeRequestedAt,
    };
  }

  const { finalized, closeRequestedAt, token, deposit, settled } = await readEscrowChannel(
    client,
    options.escrowContract,
    options.channelId,
  );
  if (!finalized && deposit === 0n) return null;
  return { finalized, token: token.toLowerCase() as Address, deposit, settled, closeRequestedAt };
}

/**
 * A stored session's channel, as a payment checks it before reusing the session. It differs from
 * `getOnChainChannel`: an escrow channel is null once finalized and reads with no deposit if it
 * was never opened; a precompile channel without a deposit is null, with no log scan to tell a
 * closed channel from one never opened; and it reads the participants, which for the precompile
 * come from the record. `rpc` lets a dry run bound the reads.
 */
export async function readOnChainChannel(record: PersistedSessionRecord, rpc: RpcOptions = {}) {
  await requireRpcChain(record.chain_id);
  const client = createTempoPublicClient(record.chain_id, rpc);
  if (isPrecompileEscrow(record.escrow_contract)) {
    const { deposit, settled, closeRequestedAt } = await readPrecompileChannel(
      client,
      record.channel_id as Hex,
    );
    if (deposit === 0n) return null;
    return {
      authorizedSigner: record.authorized_signer,
      closeRequestedAt,
      deposit,
      payee: record.payee,
      payer: record.payer,
      settled,
      token: record.token,
    };
  }

  const { finalized, ...channel } = await readEscrowChannel(
    client,
    record.escrow_contract as Address,
    record.channel_id as Hex,
  );
  if (finalized) return null;
  return channel;
}

const channelClosedEvent = parseAbiItem(
  "event ChannelClosed(bytes32 indexed channelId, address indexed payer, address indexed payee, uint96 settledToPayee, uint96 refundedToPayer)",
);

/** Whether the precompile emitted ChannelClosed for the channel within the log scan depth. */
async function precompileChannelClosed(channelId: Hex, network: Network) {
  const publicClient = createTempoPublicClient(network.chainId);
  // Include the head block: a cooperative close checks for a close mined moments ago.
  const latest = await publicClient.getBlockNumber();
  const earliest = latest > logScanDepth ? latest - logScanDepth : 0n;
  let end = latest;
  while (end >= earliest) {
    const start = end > earliest + logQueryBlockRange ? end - logQueryBlockRange : earliest;
    const logs = await publicClient.getLogs({
      address: TempoChannel.address,
      event: channelClosedEvent,
      args: { channelId },
      fromBlock: start,
      toBlock: end,
    });
    if (logs.length > 0) return true;
    if (start === earliest) break;
    end = start - 1n;
  }
  return false;
}

export function isPrecompileEscrow(address: string) {
  return address.toLowerCase() === TempoChannel.address.toLowerCase();
}

export async function readGracePeriod(options: { escrowContract: Address; network: Network }) {
  try {
    const value = (await createTempoPublicClient(options.network.chainId).readContract({
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

/** The precompile's state for `channelId`. It clears a closed channel's state to zero. */
async function readPrecompileChannel(client: TempoPublicClient, channelId: Hex) {
  const state = (await client.readContract({
    address: TempoChannel.address,
    abi: TempoAbis.tip20ChannelReserve,
    functionName: "getChannelState",
    args: [channelId],
  })) as unknown;
  const record = getRecord(state);
  const tuple = Array.isArray(state) ? state : [];
  return {
    deposit: parseOnChainBigInt(record.deposit ?? tuple[1]),
    settled: parseOnChainBigInt(record.settled ?? tuple[0]),
    closeRequestedAt: parseOnChainBigInt(record.closeRequestedAt ?? tuple[2]),
  };
}

/** The escrow contract's `getChannel` for `channelId`; a channel never opened has no deposit. */
async function readEscrowChannel(client: TempoPublicClient, escrow: Address, channelId: Hex) {
  const value = (await client.readContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "getChannel",
    args: [channelId],
  })) as unknown;
  const record = getRecord(value);
  const tuple = Array.isArray(value) ? value : [];
  return {
    finalized: Boolean(record.finalized ?? tuple[0]),
    closeRequestedAt: parseOnChainBigInt(record.closeRequestedAt ?? tuple[1]),
    payer: stringValue(record.payer ?? tuple[2]),
    payee: stringValue(record.payee ?? tuple[3]),
    token: stringValue(record.token ?? tuple[4]),
    authorizedSigner: stringValue(record.authorizedSigner ?? tuple[5]),
    deposit: parseOnChainBigInt(record.deposit ?? tuple[6]),
    settled: parseOnChainBigInt(record.settled ?? tuple[7]),
  };
}
