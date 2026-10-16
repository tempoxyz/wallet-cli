import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { cliBundle } from "./cli-bundle.js";
import { legacySessionDbPaths, migrateLegacySessions } from "../src/payment/legacy-sessions.js";
import {
  ensureChannelsTable,
  readSessionRecordsByOrigin,
  upsertSessionRecord,
  type PersistedSessionRecord,
} from "../src/payment/session-store.js";
import { querySql, runProcess, sqlite3 } from "../src/shared/process.js";
import { testAccessKey, testWallet, testWallet2, usdc, useTempHome } from "./helpers.js";

const execFileAsync = promisify(execFile);

const origin = "https://legacy.example.com";
const otherOrigin = "https://other.example.com";
const escrow = "0x0000000000000000000000000000000000000001";
// Legacy stores wrote checksummed addresses and ids; the current store reads them lowercase.
const channelId = `0x${"A".repeat(64)}`;
const otherChannelId = `0x${"b".repeat(64)}`;

/** Concurrent migrations, in this process or as separate CLI runs. */
const concurrency = 4;

type Row = {
  channel_id: string;
  origin: string;
  chain_id?: number;
  cumulative_amount?: string;
  last_used_at?: number;
  request_url?: string;
  state?: string;
};

/**
 * The legacy tables the Rust CLI wrote: `channels` before the TypeScript CLI's columns; the
 * per-origin `sessions` table with close state; and presto's first `sessions` table without it.
 */
const schemas = {
  channels: {
    create: `CREATE TABLE channels (
      channel_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, origin TEXT NOT NULL,
      request_url TEXT NOT NULL DEFAULT '', chain_id INTEGER NOT NULL, escrow_contract TEXT NOT NULL,
      token TEXT NOT NULL, payee TEXT NOT NULL, payer TEXT NOT NULL, authorized_signer TEXT NOT NULL,
      salt TEXT NOT NULL, deposit TEXT NOT NULL, cumulative_amount TEXT NOT NULL,
      challenge_echo TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active',
      close_requested_at INTEGER NOT NULL DEFAULT 0, grace_ready_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL,
      accepted_cumulative TEXT NOT NULL DEFAULT '0', server_spent TEXT NOT NULL DEFAULT '0'
    )`,
    insert: (row: Required<Row>) => `INSERT INTO channels (
      channel_id, origin, request_url, chain_id, escrow_contract, token, payee, payer,
      authorized_signer, salt, deposit, cumulative_amount, challenge_echo, state,
      close_requested_at, grace_ready_at, created_at, last_used_at, accepted_cumulative, server_spent
    ) VALUES (
      '${row.channel_id}', '${row.origin}', '${row.request_url}', ${row.chain_id}, '${escrow}',
      '${usdc}', '${testWallet2}', '${testWallet}', '${testAccessKey}', '0x01', '10000',
      '${row.cumulative_amount}', '{}', '${row.state}', 0, 0, 1, ${row.last_used_at}, '1000', '1000'
    )`,
  },
  sessions: {
    create: `CREATE TABLE sessions (
      key TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, origin TEXT NOT NULL UNIQUE,
      request_url TEXT NOT NULL DEFAULT '', chain_id INTEGER NOT NULL, escrow_contract TEXT NOT NULL,
      currency TEXT NOT NULL, recipient TEXT NOT NULL, payer TEXT NOT NULL,
      authorized_signer TEXT NOT NULL, salt TEXT NOT NULL, channel_id TEXT NOT NULL,
      deposit TEXT NOT NULL, tick_cost TEXT NOT NULL, cumulative_amount TEXT NOT NULL,
      challenge_echo TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active',
      close_requested_at INTEGER NOT NULL DEFAULT 0, grace_ready_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
    )`,
    insert: (row: Required<Row>) => `INSERT INTO sessions (
      key, origin, request_url, chain_id, escrow_contract, currency, recipient, payer,
      authorized_signer, salt, channel_id, deposit, tick_cost, cumulative_amount, challenge_echo,
      state, created_at, last_used_at
    ) VALUES (
      '${row.origin.replace(/[^A-Za-z0-9.-]/g, "_")}', '${row.origin}', '${row.request_url}',
      ${row.chain_id}, '${escrow}', '${usdc}', '${testWallet2}', '${testWallet}',
      '${testAccessKey}', '0x01', '${row.channel_id}', '10000', '100',
      '${row.cumulative_amount}', '{}', '${row.state}', 1, ${row.last_used_at}
    )`,
  },
  presto: {
    create: `CREATE TABLE sessions (
      key TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, origin TEXT NOT NULL UNIQUE,
      request_url TEXT NOT NULL DEFAULT '', network_name TEXT NOT NULL, chain_id INTEGER NOT NULL,
      escrow_contract TEXT NOT NULL, currency TEXT NOT NULL, recipient TEXT NOT NULL,
      payer TEXT NOT NULL, authorized_signer TEXT NOT NULL, salt TEXT NOT NULL,
      channel_id TEXT NOT NULL, deposit TEXT NOT NULL, tick_cost TEXT NOT NULL,
      cumulative_amount TEXT NOT NULL, did TEXT NOT NULL, challenge_echo TEXT NOT NULL,
      challenge_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE pending_closes (
      channel_id TEXT PRIMARY KEY, network TEXT NOT NULL, ready_at INTEGER NOT NULL
    )`,
    insert: (row: Required<Row>) => `INSERT INTO sessions (
      key, origin, request_url, network_name, chain_id, escrow_contract, currency, recipient,
      payer, authorized_signer, salt, channel_id, deposit, tick_cost, cumulative_amount, did,
      challenge_echo, challenge_id, created_at, last_used_at, expires_at
    ) VALUES (
      '${row.origin.replace(/[^A-Za-z0-9.-]/g, "_")}', '${row.origin}', '${row.request_url}',
      'tempo', ${row.chain_id}, '${escrow}', '${usdc}', '${testWallet2}', '${testWallet}',
      '${testAccessKey}', '0x01', '${row.channel_id}', '10000', '100',
      '${row.cumulative_amount}', 'did:pkh:eip155:4217:${testWallet}', '{}', 'challenge', 1,
      ${row.last_used_at}, 2
    )`,
  },
} as const;

type Schema = keyof typeof schemas;

/**
 * Writes a legacy session database whose sessions are only in its WAL, as a Rust CLI killed before
 * it checkpointed left it, so a migration must read, and keep, the WAL beside the database.
 */
async function seedLegacy(path: string, schema: Schema, rows: Row[]) {
  await mkdir(dirname(path), { recursive: true });
  const { create, insert } = schemas[schema];
  const inserts = rows.map((row) =>
    insert({
      chain_id: 4217,
      cumulative_amount: "2000",
      last_used_at: 10,
      request_url: `${row.origin}/v1`,
      state: "active",
      ...row,
    }),
  );
  const child = spawn(sqlite3, [path], { stdio: ["pipe", "pipe", "pipe"] });
  const closed = once(child, "close");
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  child.stdout.setEncoding("utf8");
  const written = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: string) => {
      if (chunk.includes("written")) resolve();
    });
    void closed.then(() => reject(new Error(`sqlite3 exited before writing: ${stderr}`)), reject);
  });
  child.stdin.write(`PRAGMA journal_mode = WAL;
PRAGMA wal_autocheckpoint = 0;
${create};
${inserts.join(";\n")};
SELECT 'written';
`);
  await written;
  child.kill("SIGKILL");
  await closed;
}

/** The session the current store records for `row` once migrated from a `schema` table. */
function migrated(row: Row, schema: Schema): Partial<PersistedSessionRecord> {
  // Only the `channels` table records what the server acknowledged and spent.
  const acknowledged = schema === "channels" ? 1_000n : 0n;
  return {
    accepted_cumulative: acknowledged,
    authorized_signer: testAccessKey.toLowerCase(),
    chain_id: row.chain_id ?? 4217,
    channel_id: row.channel_id.toLowerCase(),
    cumulative_amount: BigInt(row.cumulative_amount ?? "2000"),
    deposit: 10_000n,
    escrow_contract: escrow,
    last_used_at: row.last_used_at ?? 10,
    origin: row.origin,
    payee: testWallet2.toLowerCase(),
    payer: testWallet.toLowerCase(),
    request_url: row.request_url ?? `${row.origin}/v1`,
    server_spent: acknowledged,
    session_protocol: "v1",
    state: row.state ?? "active",
    token: usdc.toLowerCase(),
  };
}

function current(overrides: Partial<PersistedSessionRecord> = {}): PersistedSessionRecord {
  return {
    accepted_cumulative: 2_000n,
    authorized_signer: testAccessKey.toLowerCase(),
    chain_id: 4217,
    challenge_echo: "{}",
    channel_id: channelId.toLowerCase(),
    close_requested_at: 0,
    created_at: 1,
    cumulative_amount: 2_000n,
    deposit: 10_000n,
    escrow_contract: escrow,
    grace_ready_at: 0,
    last_used_at: 100,
    network: "tempo",
    origin,
    payee: testWallet2.toLowerCase(),
    payer: testWallet.toLowerCase(),
    request_url: `${origin}/current`,
    salt: "0x01",
    server_spent: 2_000n,
    session_protocol: "v1",
    state: "active",
    token: usdc.toLowerCase(),
    ...overrides,
  };
}

/** The names in `path`'s directory that start with its file name, sorted. */
async function siblings(path: string) {
  const names = await readdir(dirname(path));
  return names.filter((name) => name.startsWith(basename(path))).sort();
}

async function allChannels() {
  return querySql("SELECT * FROM channels ORDER BY channel_id");
}

const legacyPaths = [
  { name: "~/.tempo/channels.db", index: 0 },
  { name: "~/.tempo/sessions.db", index: 1 },
  { name: "~/.tempo/wallet/sessions.db", index: 2 },
] as const;

/** The database, and its WAL files, renamed to `<name>.migrated`. */
function movedNames(path: string) {
  const name = basename(path);
  return [`${name}.migrated`, `${name}.migrated-shm`, `${name}.migrated-wal`];
}

describe("legacy session migration", () => {
  it.each(
    legacyPaths.flatMap((legacy) =>
      (Object.keys(schemas) as Schema[]).map((schema) => ({ ...legacy, schema })),
    ),
  )(
    "moves a $schema table from $name into channels.db and keeps the file",
    async ({ index, schema }) => {
      await useTempHome();
      const path = legacySessionDbPaths()[index]!;
      const row = { channel_id: channelId, origin };
      await seedLegacy(path, schema, [row]);

      await ensureChannelsTable();

      expect(await readSessionRecordsByOrigin(origin)).toEqual([
        expect.objectContaining(migrated(row, schema)),
      ]);
      expect(await siblings(path)).toEqual(movedNames(path));
      // The renamed database still reads every session it held from its WAL.
      const kept = await runProcess(sqlite3, [
        `${path}.migrated`,
        `SELECT COUNT(*) FROM ${schema === "channels" ? "channels" : "sessions"}`,
      ]);
      expect(kept.trim()).toBe("1");
    },
  );

  it.each(
    [
      {
        name: "a channel only the current store holds is kept beside a legacy one",
        stored: current({ channel_id: otherChannelId, origin: otherOrigin }),
        legacy: { channel_id: channelId, origin },
        expected: (schema: Schema) => [
          expect.objectContaining(migrated({ channel_id: channelId, origin }, schema)),
          expect.objectContaining({ channel_id: otherChannelId, origin: otherOrigin }),
        ],
      },
      {
        name: "a channel used more recently in the legacy store takes its record",
        stored: current({ cumulative_amount: 2_500n }),
        legacy: {
          channel_id: channelId,
          origin,
          cumulative_amount: "2000",
          last_used_at: 200,
          request_url: `${origin}/legacy`,
          state: "closing",
        },
        // The signed cumulative never goes down.
        expected: () => [
          expect.objectContaining({
            cumulative_amount: 2_500n,
            last_used_at: 200,
            request_url: `${origin}/legacy`,
            state: "closing",
          }),
        ],
      },
      {
        name: "a channel used more recently in the current store keeps its record",
        stored: current(),
        legacy: {
          channel_id: channelId,
          origin,
          cumulative_amount: "3000",
          last_used_at: 50,
          request_url: `${origin}/legacy`,
          state: "closing",
        },
        expected: () => [
          expect.objectContaining({
            cumulative_amount: 3_000n,
            last_used_at: 100,
            request_url: `${origin}/current`,
            state: "active",
          }),
        ],
      },
    ].flatMap((merge) =>
      (["channels", "sessions"] as const).map((schema) => ({ ...merge, schema })),
    ),
  )("$name ($schema table)", async ({ stored, legacy, expected, schema }) => {
    await useTempHome();
    await upsertSessionRecord(stored);
    await seedLegacy(legacySessionDbPaths()[schema === "channels" ? 0 : 2]!, schema, [legacy]);

    await ensureChannelsTable();

    const records = [
      ...(await readSessionRecordsByOrigin(origin)),
      ...(await readSessionRecordsByOrigin(otherOrigin)),
    ];
    expect(records).toEqual(expected(schema));
  });

  it("changes nothing when it runs again, even over a database it already moved", async () => {
    await useTempHome();
    const path = legacySessionDbPaths()[2]!;
    await seedLegacy(path, "sessions", [
      { channel_id: channelId, origin },
      { channel_id: otherChannelId, origin: otherOrigin },
    ]);
    await ensureChannelsTable();
    const first = await allChannels();

    // A run interrupted before its rename leaves the same sessions to move again.
    await seedLegacy(path, "sessions", [
      { channel_id: channelId, origin },
      { channel_id: otherChannelId, origin: otherOrigin },
    ]);
    await ensureChannelsTable();
    await ensureChannelsTable();

    expect(await allChannels()).toEqual(first);
    const names = await siblings(path);
    expect(names).toContain(`${basename(path)}.migrated`);
    expect(names.filter((name) => /\.migrated-\d+$/.test(name))).toHaveLength(1);
    expect(names).not.toContain(basename(path));
  });

  it("moves each database once under concurrent runs", async () => {
    await useTempHome();
    const paths = legacySessionDbPaths();
    await seedLegacy(paths[0]!, "channels", [{ channel_id: channelId, origin }]);
    await seedLegacy(paths[2]!, "sessions", [{ channel_id: otherChannelId, origin: otherOrigin }]);

    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, () => ensureChannelsTable()),
    );

    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    expect(getChannelIds(await allChannels())).toEqual([channelId.toLowerCase(), otherChannelId]);
    for (const path of [paths[0]!, paths[2]!])
      expect(await siblings(path)).toEqual(movedNames(path));
    expect(await siblings(paths[1]!)).toEqual([]);
  });

  it("lists moved sessions from concurrent CLI runs", async () => {
    await useTempHome();
    await seedLegacy(legacySessionDbPaths()[2]!, "sessions", [
      { channel_id: channelId, origin, chain_id: 42431 },
    ]);

    const runs = await Promise.all(
      Array.from({ length: concurrency }, () =>
        execFileAsync(
          process.execPath,
          [cliBundle("wallet"), "sessions", "list", "-n", "testnet", "--format", "json"],
          { env: { ...process.env, NO_COLOR: "1" } },
        ),
      ),
    );

    for (const { stdout, stderr } of runs) {
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        sessions: [{ channel_id: channelId.toLowerCase(), origin, status: "active" }],
        total: 1,
      });
    }
  });

  it("renames an empty legacy file without adding sessions", async () => {
    await useTempHome();
    const path = legacySessionDbPaths()[0]!;
    await writeFile(path, "");

    await ensureChannelsTable();

    expect(await allChannels()).toEqual([]);
    expect(await siblings(path)).toEqual([`${basename(path)}.migrated`]);
  });

  it.each([
    {
      name: "is not a database",
      seed: (path: string) => writeFile(path, "not a database, just text"),
      reason: "file is not a database",
    },
    {
      name: "has a session table without channel ids",
      seed: (path: string) =>
        runProcess(sqlite3, [path, "CREATE TABLE sessions (origin TEXT, deposit TEXT)"]),
      reason: "its sessions table lacks a column a session needs",
    },
  ])("keeps a legacy file that $name in place and warns once", async ({ seed, reason }) => {
    await useTempHome();
    const path = legacySessionDbPaths()[1]!;
    await mkdir(dirname(path), { recursive: true });
    await seed(path);
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await ensureChannelsTable();
    await ensureChannelsTable();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(path);
    expect(warn.mock.calls[0]?.[0]).toContain(reason);
    expect(await siblings(path)).toEqual([basename(path)]);
    expect(await allChannels()).toEqual([]);
  });

  it("does nothing without legacy databases", async () => {
    await useTempHome();

    await migrateLegacySessions();

    expect(await readdir(join(homedir(), ".tempo", "wallet"))).toEqual([]);
  });
});

function getChannelIds(rows: unknown) {
  return (rows as { channel_id: string }[]).map((row) => row.channel_id);
}
