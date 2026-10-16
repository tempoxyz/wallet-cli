import { getAddress, parseAbiItem, type Address, type Hex } from "viem";
import { Abis as TempoAbis, Channel as TempoChannel } from "viem/tempo";

import {
  defaultGracePeriodSeconds,
  escrowAbi,
  logHeadMargin,
  logQueryBlockRange,
  logScanDepth,
} from "../shared/constants.js";
import {
  createTempoPublicClient,
  escrowContract,
  tokenAddress,
  type Network,
} from "../shared/network.js";
import { getRecord, parseOnChainBigInt, stringValue } from "../shared/utils.js";
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
};

export async function findAllChannelsForPayer(options: { network: Network; payer: Address }) {
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

/**
 * The channel's escrow state on `network`, or null when the escrow has no such channel. Unlike
 * `readOnChainChannel`, a finalized channel is returned with `finalized` set.
 */
export async function getOnChainChannel(options: {
  channelId: Hex;
  escrowContract: Address;
  network: Network;
}) {
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
