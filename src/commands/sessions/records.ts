import type { Address } from "viem";

import { networkName, tokenDecimals, type Network } from "../../shared/network.js";
import { querySql, runSql, sqlString } from "../../shared/process.js";
import { tokenSymbol } from "../../shared/tokens.js";
import {
  formatTokenUnits,
  formatUnixTimestamp,
  getArray,
  getRecord,
  isChannelId,
  nowSeconds,
  parseStoredBigInt,
  safeNumber,
  stringValue,
} from "../../shared/utils.js";
import {
  findAllChannelsForPayer,
  readGracePeriod,
  type OnChainDiscoveredChannel,
} from "../../payment/channel.js";
import { ensureChannelsTable } from "../../payment/session-store.js";
import { loadWalletState } from "../../wallet/store.js";

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

/**
 * The highest voucher the server acknowledged, else the signed cumulative. A higher stored
 * cumulative is not proof of spend: a payment saves it before creating the voucher, so counting
 * it could hide a deposit that is still refundable.
 */
function sessionSpent(record: ChannelRecord) {
  return record.accepted_cumulative > 0n ? record.accepted_cumulative : record.cumulative_amount;
}

export function unspentDeposit(record: ChannelRecord) {
  const spent = sessionSpent(record);
  return record.deposit > spent ? record.deposit - spent : 0n;
}

export function sessionItem(record: ChannelRecord) {
  const spent = sessionSpent(record);
  const remaining = unspentDeposit(record);
  const status = sessionStatus(record);
  return {
    channel_id: record.channel_id,
    network: record.network,
    origin: record.origin,
    symbol: tokenSymbol(record.token, record.chain_id) ?? null,
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

export async function readChannelRecords(): Promise<ChannelRecord[]> {
  await ensureChannelsTable();
  const query = `SELECT version, origin, request_url, chain_id,
                    escrow_contract, token, payee, payer, authorized_signer,
                    salt, channel_id, session_protocol, descriptor_json, deposit, cumulative_amount, accepted_cumulative,
                    challenge_echo, state, close_requested_at, grace_ready_at, created_at, last_used_at,
                    server_spent
             FROM channels
             WHERE origin <> 'http://127.0.0.1'
             ORDER BY last_used_at DESC`;

  let rows: unknown;
  try {
    rows = await querySql(query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("unable to open database file") || message.includes("no such table"))
      return [];
    throw error;
  }
  return getArray(rows).flatMap((row) => {
    const item = getRecord(row);
    const channelId = stringValue(item.channel_id).toLowerCase();
    const chain = typeof item.chain_id === "number" ? item.chain_id : Number(item.chain_id);
    const token = stringValue(item.token).toLowerCase();
    if (!isChannelId(channelId) || !Number.isFinite(chain) || !token) return [];
    return [
      {
        channel_id: channelId,
        network: networkName(chain),
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

export async function discoverAndPersistOrphanedChannels(network: Network) {
  const records = await readChannelRecords();
  const state = await loadWalletState();
  const activeAccount = state.accounts[state.activeAccount ?? 0];
  const wallet = activeAccount?.address;
  if (!wallet) return records;

  const localIds = new Set(
    records
      .filter((record) => record.chain_id === network.chainId)
      .map((record) => record.channel_id),
  );
  const discovered = await findAllChannelsForPayer({ network, payer: wallet as Address });

  for (const channel of discovered) {
    if (localIds.has(channel.channelId.toLowerCase())) continue;
    const gracePeriod = await readGracePeriod({
      escrowContract: channel.escrowContract,
      network,
    });
    await saveDiscoveredChannel({
      channel,
      chainId: network.chainId,
      gracePeriod,
      payer: wallet,
      state: sessionStateFromCloseTiming(Number(channel.closeRequestedAt), gracePeriod),
    });
  }

  return readChannelRecords();
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
  // A session stored since the scan began, or one the listing hides, keeps its stored record.
  await runSql(`INSERT OR IGNORE INTO channels (
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

export async function deleteChannelRecord(channelId: string) {
  await runSql(`DELETE FROM channels WHERE channel_id = ${sqlString(channelId)}`);
}

export async function updateChannelCloseState(options: {
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

export function sessionStateFromCloseTiming(
  closeRequestedAt: number,
  gracePeriod: number,
): ChannelState {
  if (closeRequestedAt === 0) return "orphaned";
  return closeRequestedAt + gracePeriod <= nowSeconds() ? "finalizable" : "closing";
}

export function sessionStatus(record: ChannelRecord) {
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
