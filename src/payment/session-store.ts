import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { channelsDbPath, runProcess, runSql, sqlString } from "../shared/process.js";
import {
  getArray,
  getRecord,
  isChannelId,
  nowSeconds,
  parseStoredBigInt,
  safeNumber,
  stringValue,
} from "../shared/utils.js";
import { networkName } from "../shared/network.js";

export type PersistedSessionRecord = {
  accepted_cumulative: bigint;
  authorized_signer: string;
  chain_id: number;
  challenge_echo: string;
  channel_id: string;
  close_requested_at: number;
  created_at: number;
  cumulative_amount: bigint;
  deposit: bigint;
  descriptor_json?: string | undefined;
  escrow_contract: string;
  grace_ready_at: number;
  last_used_at: number;
  network: string;
  origin: string;
  payee: string;
  payer: string;
  request_url: string;
  salt: string;
  server_spent: bigint;
  session_protocol: string;
  state: string;
  token: string;
};

export async function findReusableSession(options: {
  authorizedSigner: string;
  chainId: number;
  escrowContract: string;
  origin: string;
  payee: string;
  payer: string;
  token: string;
}) {
  const records = await readSessionRecordsByOrigin(options.origin);
  const signer = normalizeAddress(options.authorizedSigner);
  const escrow = normalizeAddress(options.escrowContract);
  const payee = normalizeAddress(options.payee);
  const payer = normalizeAddress(options.payer);
  const token = normalizeAddress(options.token);
  return records.find(
    (record) =>
      record.state === "active" &&
      record.close_requested_at === 0 &&
      record.chain_id === options.chainId &&
      normalizeAddress(record.escrow_contract) === escrow &&
      normalizeAddress(record.payee) === payee &&
      normalizeAddress(record.payer) === payer &&
      normalizeAddress(record.authorized_signer) === signer &&
      normalizeAddress(record.token) === token,
  );
}

export async function readSessionRecordsByOrigin(origin: string) {
  await ensureChannelsTable();
  const query = `SELECT version, origin, request_url, chain_id,
                    escrow_contract, token, payee, payer, authorized_signer,
                    salt, channel_id, session_protocol, descriptor_json, deposit, cumulative_amount,
                    accepted_cumulative, challenge_echo, state, close_requested_at, grace_ready_at,
                    created_at, last_used_at, server_spent
             FROM channels
             WHERE origin = ${sqlString(origin)}
             ORDER BY last_used_at DESC`;
  const stdout = await runProcess("sqlite3", ["-json", channelsDbPath(), query]);
  const rows = JSON.parse(stdout || "[]") as unknown;
  return getArray(rows).flatMap(decodeRecord);
}

export async function upsertSessionRecord(record: PersistedSessionRecord) {
  await ensureChannelsTable();
  await runSql(`INSERT INTO channels (
    channel_id, version, origin, request_url, chain_id, escrow_contract, token, payee, payer,
    authorized_signer, salt, session_protocol, descriptor_json, deposit, cumulative_amount,
    accepted_cumulative, challenge_echo, state, close_requested_at, grace_ready_at, created_at,
    last_used_at, server_spent
  ) VALUES (
    ${sqlString(record.channel_id)}, 1, ${sqlString(record.origin)}, ${sqlString(record.request_url)},
    ${record.chain_id}, ${sqlString(record.escrow_contract)}, ${sqlString(record.token)},
    ${sqlString(record.payee)}, ${sqlString(record.payer)}, ${sqlString(record.authorized_signer)},
    ${sqlString(record.salt)}, ${sqlString(record.session_protocol)},
    ${record.descriptor_json ? sqlString(record.descriptor_json) : "NULL"},
    ${sqlString(record.deposit.toString())}, ${sqlString(record.cumulative_amount.toString())},
    ${sqlString(record.accepted_cumulative.toString())}, ${sqlString(record.challenge_echo)},
    ${sqlString(record.state)}, ${record.close_requested_at}, ${record.grace_ready_at},
    ${record.created_at}, ${record.last_used_at}, ${sqlString(record.server_spent.toString())}
  ) ON CONFLICT(channel_id) DO UPDATE SET
    origin = excluded.origin,
    request_url = excluded.request_url,
    chain_id = excluded.chain_id,
    escrow_contract = excluded.escrow_contract,
    token = excluded.token,
    payee = excluded.payee,
    payer = excluded.payer,
    authorized_signer = excluded.authorized_signer,
    salt = excluded.salt,
    session_protocol = excluded.session_protocol,
    descriptor_json = excluded.descriptor_json,
    deposit = ${maxDecimalSql("channels.deposit", "excluded.deposit")},
    cumulative_amount = ${maxDecimalSql("channels.cumulative_amount", "excluded.cumulative_amount")},
    accepted_cumulative = ${maxDecimalSql("channels.accepted_cumulative", "excluded.accepted_cumulative")},
    challenge_echo = excluded.challenge_echo,
    state = excluded.state,
    close_requested_at = excluded.close_requested_at,
    grace_ready_at = excluded.grace_ready_at,
    last_used_at = excluded.last_used_at,
    server_spent = ${maxDecimalSql("channels.server_spent", "excluded.server_spent")}`);
}

export async function preserveSessionCumulative(channelId: string, cumulativeAmount: bigint) {
  await ensureChannelsTable();
  const value = cumulativeAmount.toString();
  await runSql(`UPDATE channels SET
    cumulative_amount = ${maxDecimalSql("cumulative_amount", sqlString(value))},
    last_used_at = ${nowSeconds()}
    WHERE LOWER(channel_id) = LOWER(${sqlString(channelId)})`);
}

export async function updateSessionReceipt(options: {
  acceptedCumulative: bigint;
  channelId: string;
  serverSpent: bigint;
  signedCumulative: bigint;
}) {
  await ensureChannelsTable();
  await runSql(`UPDATE channels SET
    cumulative_amount = ${maxDecimalSql("cumulative_amount", sqlString(options.signedCumulative.toString()))},
    accepted_cumulative = ${maxDecimalSql("accepted_cumulative", sqlString(options.acceptedCumulative.toString()))},
    server_spent = ${maxDecimalSql("server_spent", sqlString(options.serverSpent.toString()))},
    last_used_at = ${nowSeconds()}
    WHERE LOWER(channel_id) = LOWER(${sqlString(options.channelId)})`);
}

export async function deleteSessionRecord(channelId: string) {
  await ensureChannelsTable();
  await runSql(`DELETE FROM channels WHERE LOWER(channel_id) = LOWER(${sqlString(channelId)})`);
}

export function originFromUrl(url: string) {
  return new URL(url).origin;
}

export async function ensureChannelsTable() {
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
  await runSql("CREATE INDEX IF NOT EXISTS idx_channels_origin ON channels(origin)");
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

function maxDecimalSql(left: string, right: string) {
  return `CASE
      WHEN LENGTH(${left}) > LENGTH(${right}) THEN ${left}
      WHEN LENGTH(${left}) < LENGTH(${right}) THEN ${right}
      WHEN ${left} >= ${right} THEN ${left}
      ELSE ${right}
    END`;
}

function decodeRecord(row: unknown): PersistedSessionRecord[] {
  const item = getRecord(row);
  const channelId = stringValue(item.channel_id).toLowerCase();
  const chain = typeof item.chain_id === "number" ? item.chain_id : Number(item.chain_id);
  const token = stringValue(item.token).toLowerCase();
  if (!isChannelId(channelId) || !Number.isFinite(chain) || !token) return [];

  return [
    {
      accepted_cumulative: parseStoredBigInt(item.accepted_cumulative),
      authorized_signer: stringValue(item.authorized_signer).toLowerCase(),
      chain_id: chain,
      challenge_echo: stringValue(item.challenge_echo),
      channel_id: channelId,
      close_requested_at: safeNumber(item.close_requested_at),
      created_at: safeNumber(item.created_at),
      cumulative_amount: parseStoredBigInt(item.cumulative_amount),
      deposit: parseStoredBigInt(item.deposit),
      descriptor_json: stringValue(item.descriptor_json) || undefined,
      escrow_contract: stringValue(item.escrow_contract).toLowerCase(),
      grace_ready_at: safeNumber(item.grace_ready_at),
      last_used_at: safeNumber(item.last_used_at),
      network: networkName(chain) ?? `chain-${chain}`,
      origin: stringValue(item.origin),
      payee: stringValue(item.payee).toLowerCase(),
      payer: stringValue(item.payer).toLowerCase(),
      request_url: stringValue(item.request_url),
      salt: stringValue(item.salt),
      server_spent: parseStoredBigInt(item.server_spent),
      session_protocol: stringValue(item.session_protocol) || "v1",
      state: stringValue(item.state) || "active",
      token,
    },
  ];
}

function normalizeAddress(value: string) {
  return value.toLowerCase();
}
