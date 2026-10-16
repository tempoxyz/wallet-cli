import { spawn } from "node:child_process";
import { once } from "node:events";

import { describe, expect, it } from "vitest";

import { listSessions } from "../src/commands/sessions/list.js";
import {
  deleteSessionRecord,
  ensureChannelsTable,
  readSessionRecordsByOrigin,
  updateSessionReceipt,
  upsertSessionRecord,
  type PersistedSessionRecord,
} from "../src/payment/session-store.js";
import { channelsDbPath, querySql, runSql } from "../src/shared/process.js";
import { sleep } from "../src/shared/utils.js";

import { testAccessKey, testWallet, testWallet2, usdc, useTempHome } from "./helpers.js";

const origin = "https://example.com";
const channelId = `0x${"a".repeat(64)}`;
const otherChannelId = `0x${"b".repeat(64)}`;

/** Concurrent initializations; each statement runs in its own sqlite3 process. */
const concurrency = 8;

/** The channels table as older releases created it, before any of the added columns. */
const originalSchema = `CREATE TABLE channels (
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
  last_used_at INTEGER NOT NULL
);
CREATE INDEX idx_channels_origin ON channels(origin);`;

const originalRow = `INSERT INTO channels (
  channel_id, origin, chain_id, escrow_contract, token, payee, payer, authorized_signer, salt,
  deposit, cumulative_amount, challenge_echo, created_at, last_used_at
) VALUES (
  '${channelId}', '${origin}', 4217, '0x0000000000000000000000000000000000000001', '${usdc}',
  '${testWallet2}', '${testWallet}', '${testAccessKey}', '0x00', '10000', '2000', '{}', 1, 1
);`;

const channelColumns = [
  "accepted_cumulative",
  "authorized_signer",
  "chain_id",
  "challenge_echo",
  "channel_id",
  "close_requested_at",
  "created_at",
  "cumulative_amount",
  "deposit",
  "descriptor_json",
  "escrow_contract",
  "grace_ready_at",
  "last_used_at",
  "origin",
  "payee",
  "payer",
  "request_url",
  "salt",
  "server_spent",
  "session_protocol",
  "state",
  "token",
  "version",
];

describe("channels store initialization", () => {
  it.each([
    { name: "a fresh database", setup: "", sessions: 0 },
    { name: "the original schema", setup: `${originalSchema}\n${originalRow}`, sessions: 1 },
    {
      name: "a partially migrated schema",
      setup: `${originalSchema}
        ALTER TABLE channels ADD COLUMN accepted_cumulative TEXT NOT NULL DEFAULT '0';
        ALTER TABLE channels ADD COLUMN server_spent TEXT NOT NULL DEFAULT '0';
        ${originalRow}`,
      sessions: 1,
    },
  ])("brings $name up to date from concurrent processes", async ({ setup, sessions }) => {
    await useTempHome();
    if (setup) await runSql(setup);

    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, () => ensureChannelsTable()),
    );

    expect(
      results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    ).toEqual([]);
    expect(await querySql("SELECT name FROM pragma_table_info('channels') ORDER BY name")).toEqual(
      channelColumns.map((name) => ({ name })),
    );
    expect(
      await querySql(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_channels_origin'",
      ),
    ).toEqual([{ name: "idx_channels_origin" }]);
    const records = await readSessionRecordsByOrigin(origin);
    expect(records).toHaveLength(sessions);
    for (const record of records)
      expect(record).toMatchObject({
        accepted_cumulative: 0n,
        server_spent: 0n,
        session_protocol: "v1",
      });
  });
});

describe("channels store under a concurrent writer", () => {
  it.each([
    {
      name: "reads sessions",
      run: () => readSessionRecordsByOrigin(origin),
      channels: [channelId],
    },
    {
      name: "lists sessions",
      run: () => listSessions(),
      channels: [channelId],
    },
    {
      name: "upserts a session",
      run: () => upsertSessionRecord(session({ channel_id: otherChannelId, last_used_at: 3 })),
      channels: [otherChannelId, channelId],
    },
    {
      name: "records a receipt",
      run: () =>
        updateSessionReceipt({
          acceptedCumulative: 3_000n,
          channelId,
          serverSpent: 3_000n,
          signedCumulative: 3_000n,
        }),
      channels: [channelId],
    },
    {
      name: "deletes a session",
      run: () => deleteSessionRecord(channelId),
      channels: [],
    },
  ])("$name while another process holds the write lock", async ({ run, channels }) => {
    await useTempHome();
    await upsertSessionRecord(session());

    const unlock = await lockChannelsDb("UPDATE channels SET last_used_at = 2");
    const released = sleep(250).then(unlock);
    await run().finally(() => released);

    const records = await readSessionRecordsByOrigin(origin);
    expect(records.map((record) => record.channel_id)).toEqual(channels);
  });
});

/** Holds an exclusive write transaction on channels.db in another process until committed. */
async function lockChannelsDb(sql: string) {
  const child = spawn("sqlite3", [channelsDbPath()], { stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(child, "close");
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  child.stdout.setEncoding("utf8");
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: string) => {
      if (chunk.includes("locked")) resolve();
    });
    void closed.then(() => reject(new Error(`sqlite3 exited before locking: ${stderr}`)), reject);
  });
  child.stdin.write(`BEGIN EXCLUSIVE;\n${sql};\nSELECT 'locked';\n`);
  await locked;
  return async () => {
    child.stdin.end("COMMIT;\n");
    const [code] = await closed;
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  };
}

function session(overrides: Partial<PersistedSessionRecord> = {}): PersistedSessionRecord {
  return {
    accepted_cumulative: 2_000n,
    authorized_signer: testAccessKey,
    chain_id: 4217,
    challenge_echo: "{}",
    channel_id: channelId,
    close_requested_at: 0,
    created_at: 1,
    cumulative_amount: 2_000n,
    deposit: 10_000n,
    escrow_contract: "0x0000000000000000000000000000000000000001",
    grace_ready_at: 0,
    last_used_at: 1,
    network: "tempo",
    origin,
    payee: testWallet2,
    payer: testWallet,
    request_url: `${origin}/`,
    salt: `0x${"0".repeat(64)}`,
    server_spent: 2_000n,
    session_protocol: "v1",
    state: "active",
    token: usdc,
    ...overrides,
  };
}
