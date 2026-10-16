import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { link, mkdir, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { cliBundle } from "./cli-bundle.js";
import { importLegacySessions, legacySessionDbPaths } from "../src/payment/legacy-sessions.js";
import {
  ensureChannelsTable,
  findReusableSessions,
  readSessionRecordsByOrigin,
  upsertSessionRecord,
  type PersistedSessionRecord,
} from "../src/payment/session-store.js";
import { querySql, runProcess, runSql, runSqlScript, sqlite3 } from "../src/shared/process.js";
import { testAccessKey, testWallet, testWallet2, usdc, useTempHome } from "./helpers.js";

const execFileAsync = promisify(execFile);

const origin = "https://legacy.example.com";
const otherOrigin = "https://other.example.com";
const escrow = "0x0000000000000000000000000000000000000001";
// Legacy stores wrote checksummed addresses and ids; the current store reads them lowercase.
const channelId = `0x${"A".repeat(64)}`;
const otherChannelId = `0x${"b".repeat(64)}`;
/** When a requested close can be finalized. */
const readyAt = 2_000_000_000;
// The escrow's grace period, which only the `channels` and later `sessions` tables imply.
const gracePeriod = 900;

/** Concurrent imports, in this process or as separate CLI runs. */
const concurrency = 4;

type Row = {
  channel_id: string;
  origin: string;
  chain_id?: number;
  /** When the requested close of this channel can be finalized; none while it is active. */
  closing?: number;
  cumulative_amount?: string;
  last_used_at?: number;
  request_url?: string;
};

type Seeded = Required<Omit<Row, "closing">> & { closing: number | undefined };

/** A legacy row's close columns: `closing` until `closing` when set, else `active`. */
function closeValues(row: Seeded) {
  return row.closing === undefined
    ? "'active', 0, 0"
    : `'closing', ${row.closing - gracePeriod}, ${row.closing}`;
}

/**
 * The legacy tables the Rust CLI wrote: `channels` before the TypeScript CLI's columns; the
 * per-origin `sessions` table with close state; and presto's first `sessions` table, which kept
 * requested closes in `pending_closes`.
 */
const schemas = {
  channels: {
    create: `CREATE TABLE IF NOT EXISTS channels (
      channel_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, origin TEXT NOT NULL,
      request_url TEXT NOT NULL DEFAULT '', chain_id INTEGER NOT NULL, escrow_contract TEXT NOT NULL,
      token TEXT NOT NULL, payee TEXT NOT NULL, payer TEXT NOT NULL, authorized_signer TEXT NOT NULL,
      salt TEXT NOT NULL, deposit TEXT NOT NULL, cumulative_amount TEXT NOT NULL,
      challenge_echo TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active',
      close_requested_at INTEGER NOT NULL DEFAULT 0, grace_ready_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL,
      accepted_cumulative TEXT NOT NULL DEFAULT '0', server_spent TEXT NOT NULL DEFAULT '0'
    )`,
    insert: (row: Seeded) => `INSERT INTO channels (
      channel_id, origin, request_url, chain_id, escrow_contract, token, payee, payer,
      authorized_signer, salt, deposit, cumulative_amount, challenge_echo, state,
      close_requested_at, grace_ready_at, created_at, last_used_at, accepted_cumulative, server_spent
    ) VALUES (
      '${row.channel_id}', '${row.origin}', '${row.request_url}', ${row.chain_id}, '${escrow}',
      '${usdc}', '${testWallet2}', '${testWallet}', '${testAccessKey}', '0x01', '10000',
      '${row.cumulative_amount}', '{}', ${closeValues(row)}, 1, ${row.last_used_at}, '1000', '1000'
    )`,
  },
  sessions: {
    create: `CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, origin TEXT NOT NULL UNIQUE,
      request_url TEXT NOT NULL DEFAULT '', chain_id INTEGER NOT NULL, escrow_contract TEXT NOT NULL,
      currency TEXT NOT NULL, recipient TEXT NOT NULL, payer TEXT NOT NULL,
      authorized_signer TEXT NOT NULL, salt TEXT NOT NULL, channel_id TEXT NOT NULL,
      deposit TEXT NOT NULL, tick_cost TEXT NOT NULL, cumulative_amount TEXT NOT NULL,
      challenge_echo TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active',
      close_requested_at INTEGER NOT NULL DEFAULT 0, grace_ready_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL
    )`,
    insert: (row: Seeded) => `INSERT INTO sessions (
      key, origin, request_url, chain_id, escrow_contract, currency, recipient, payer,
      authorized_signer, salt, channel_id, deposit, tick_cost, cumulative_amount, challenge_echo,
      state, close_requested_at, grace_ready_at, created_at, last_used_at
    ) VALUES (
      '${row.origin.replace(/[^A-Za-z0-9.-]/g, "_")}', '${row.origin}', '${row.request_url}',
      ${row.chain_id}, '${escrow}', '${usdc}', '${testWallet2}', '${testWallet}',
      '${testAccessKey}', '0x01', '${row.channel_id}', '10000', '100',
      '${row.cumulative_amount}', '{}', ${closeValues(row)}, 1, ${row.last_used_at}
    )`,
  },
  presto: {
    create: `CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, origin TEXT NOT NULL UNIQUE,
      request_url TEXT NOT NULL DEFAULT '', network_name TEXT NOT NULL, chain_id INTEGER NOT NULL,
      escrow_contract TEXT NOT NULL, currency TEXT NOT NULL, recipient TEXT NOT NULL,
      payer TEXT NOT NULL, authorized_signer TEXT NOT NULL, salt TEXT NOT NULL,
      channel_id TEXT NOT NULL, deposit TEXT NOT NULL, tick_cost TEXT NOT NULL,
      cumulative_amount TEXT NOT NULL, did TEXT NOT NULL, challenge_echo TEXT NOT NULL,
      challenge_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pending_closes (
      channel_id TEXT PRIMARY KEY, network TEXT NOT NULL, ready_at INTEGER NOT NULL
    )`,
    insert: (row: Seeded) => `INSERT INTO sessions (
      key, origin, request_url, network_name, chain_id, escrow_contract, currency, recipient,
      payer, authorized_signer, salt, channel_id, deposit, tick_cost, cumulative_amount, did,
      challenge_echo, challenge_id, created_at, last_used_at, expires_at
    ) VALUES (
      '${row.origin.replace(/[^A-Za-z0-9.-]/g, "_")}', '${row.origin}', '${row.request_url}',
      'tempo', ${row.chain_id}, '${escrow}', '${usdc}', '${testWallet2}', '${testWallet}',
      '${testAccessKey}', '0x01', '${row.channel_id}', '10000', '100',
      '${row.cumulative_amount}', 'did:pkh:eip155:4217:${testWallet}', '{}', 'challenge', 1,
      ${row.last_used_at}, 2
    )${
      row.closing === undefined
        ? ""
        : `;\nINSERT INTO pending_closes VALUES ('${row.channel_id}', 'tempo', ${row.closing})`
    }`,
  },
} as const;

type Schema = keyof typeof schemas;

/**
 * Writes `rows` to a legacy session database, creating it if needed, and leaves them only in its
 * WAL, as a Rust CLI killed before it checkpointed did, so reading them needs the WAL.
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
      ...row,
      closing: row.closing,
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
  expect(stderr).toBe("");
}

/** The session the current store records for `row` once copied from a `schema` table. */
function copied(row: Row, schema: Schema): Partial<PersistedSessionRecord> {
  // Only the `channels` table records what the server acknowledged and spent.
  const acknowledged = schema === "channels" ? 1_000n : 0n;
  return {
    accepted_cumulative: acknowledged,
    authorized_signer: testAccessKey.toLowerCase(),
    chain_id: row.chain_id ?? 4217,
    channel_id: row.channel_id.toLowerCase(),
    // presto recorded only when a close can be finalized, not when it was requested.
    close_requested_at:
      row.closing === undefined || schema === "presto" ? 0 : row.closing - gracePeriod,
    cumulative_amount: BigInt(row.cumulative_amount ?? "2000"),
    deposit: 10_000n,
    escrow_contract: escrow,
    grace_ready_at: row.closing ?? 0,
    last_used_at: row.last_used_at ?? 10,
    origin: row.origin,
    payee: testWallet2.toLowerCase(),
    payer: testWallet.toLowerCase(),
    request_url: row.request_url ?? `${row.origin}/v1`,
    server_spent: acknowledged,
    session_protocol: "v1",
    state: row.closing === undefined ? "active" : "closing",
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

/** Every stored session of the test origins. */
async function records() {
  return [
    ...(await readSessionRecordsByOrigin(origin)),
    ...(await readSessionRecordsByOrigin(otherOrigin)),
  ];
}

async function reusable(target: string) {
  return findReusableSessions({
    authorizedSigner: testAccessKey,
    chainId: 4217,
    escrowContract: escrow,
    origin: target,
    payee: testWallet2,
    payer: testWallet,
    token: usdc,
  });
}

/** Expects the legacy database at `path` where it was, still holding `count` sessions. */
async function expectKept(path: string, schema: Schema, count: number) {
  const names = await readdir(dirname(path));
  const name = basename(path);
  expect(names.filter((entry) => entry.startsWith(name)).sort()).toEqual(
    expect.arrayContaining([name]),
  );
  expect(names.filter((entry) => entry.startsWith(`${name}.`))).toEqual([]);
  const table = schema === "channels" ? "channels" : "sessions";
  const held = await runProcess(sqlite3, [path, `SELECT COUNT(*) FROM ${table}`]);
  expect(held.trim()).toBe(`${count}`);
}

async function allChannels() {
  return querySql("SELECT * FROM channels ORDER BY channel_id");
}

/** Runs `tempo wallet sessions list` on testnet in a separate process. */
async function listSessions() {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliBundle("wallet"), "sessions", "list", "-n", "testnet", "--format", "json"],
    { env: { ...process.env, NO_COLOR: "1" } },
  );
  expect(stderr).toBe("");
  return JSON.parse(stdout) as { sessions: { channel_id: string; status: string }[] };
}

const legacyPaths = [
  { name: "~/.tempo/channels.db", index: 0 },
  { name: "~/.tempo/sessions.db", index: 1 },
  { name: "~/.tempo/wallet/sessions.db", index: 2 },
] as const;

const allSchemas = Object.keys(schemas) as Schema[];

describe("runSqlScript", () => {
  it.each([
    { name: "applies a script that succeeds", conflict: false, marked: 1 },
    { name: "commits nothing when a statement fails", conflict: true, marked: 0 },
  ])("$name", async ({ conflict, marked }) => {
    await useTempHome();
    await runSql("CREATE TABLE t (id INTEGER PRIMARY KEY); CREATE TABLE m (x)");
    if (conflict) await runSql("INSERT INTO t VALUES (1)");

    const run = runSqlScript(
      "BEGIN;\nINSERT INTO t VALUES (1);\nINSERT INTO m VALUES (1);\nCOMMIT;\n",
    );

    await (conflict ? expect(run).rejects.toThrow("UNIQUE constraint failed") : run);
    expect(await querySql("SELECT COUNT(*) AS n FROM m")).toEqual([{ n: marked }]);
  });
});

describe("legacy session import", () => {
  it.each(legacyPaths.flatMap((legacy) => allSchemas.map((schema) => ({ ...legacy, schema }))))(
    "copies a $schema table from $name through its WAL and leaves the file",
    async ({ index, schema }) => {
      await useTempHome();
      const path = legacySessionDbPaths()[index]!;
      const row = { channel_id: channelId, origin };
      await seedLegacy(path, schema, [row]);

      await ensureChannelsTable();

      expect(await records()).toEqual([expect.objectContaining(copied(row, schema))]);
      await expectKept(path, schema, 1);
    },
  );

  it.each(allSchemas)(
    "keeps a requested close from a %s table out of reuse until it is finalized",
    async (schema) => {
      await useTempHome();
      const closing = { channel_id: channelId, origin, closing: readyAt };
      const active = { channel_id: otherChannelId, origin: otherOrigin };
      await seedLegacy(legacySessionDbPaths()[2]!, schema, [closing, active]);

      await ensureChannelsTable();

      expect(await records()).toEqual([
        expect.objectContaining(copied(closing, schema)),
        expect.objectContaining(copied(active, schema)),
      ]);
      expect(await reusable(origin)).toEqual([]);
      expect(await reusable(otherOrigin)).toEqual([
        expect.objectContaining({ channel_id: otherChannelId }),
      ]);
    },
  );

  it.each(
    [
      {
        name: "a channel only the current store holds is kept beside a legacy one",
        stored: current({ channel_id: otherChannelId, origin: otherOrigin }),
        legacy: { channel_id: channelId, origin },
        expected: (schema: Schema) => [
          expect.objectContaining(copied({ channel_id: channelId, origin }, schema)),
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
        },
        // The signed cumulative never goes down.
        expected: () => [
          expect.objectContaining({
            cumulative_amount: 2_500n,
            last_used_at: 200,
            request_url: `${origin}/legacy`,
            state: "active",
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
      {
        name: "a close the older legacy record requested is kept",
        stored: current(),
        legacy: { channel_id: channelId, origin, closing: readyAt, last_used_at: 50 },
        expected: () => [
          expect.objectContaining({
            grace_ready_at: readyAt,
            last_used_at: 100,
            request_url: `${origin}/current`,
            state: "closing",
          }),
        ],
      },
      {
        name: "a close the current store recorded is kept over a newer active legacy record",
        stored: current({ close_requested_at: 1, grace_ready_at: readyAt, state: "closing" }),
        legacy: { channel_id: channelId, origin, last_used_at: 200 },
        expected: () => [
          expect.objectContaining({
            close_requested_at: 1,
            grace_ready_at: readyAt,
            last_used_at: 200,
            state: "closing",
          }),
        ],
      },
    ].flatMap((merge) => allSchemas.map((schema) => ({ ...merge, schema }))),
  )("$name ($schema table)", async ({ stored, legacy, expected, schema }) => {
    await useTempHome();
    await upsertSessionRecord(stored);
    await seedLegacy(legacySessionDbPaths()[schema === "channels" ? 0 : 2]!, schema, [legacy]);

    await ensureChannelsTable();

    expect(await records()).toEqual(expected(schema));
  });

  it("merges into a stored channel whose id is not lowercase", async () => {
    await useTempHome();
    await upsertSessionRecord(current({ channel_id: channelId, cumulative_amount: 1_000n }));
    await seedLegacy(legacySessionDbPaths()[2]!, "sessions", [
      { channel_id: channelId.toLowerCase(), origin, cumulative_amount: "4000" },
    ]);

    await ensureChannelsTable();

    expect(await querySql("SELECT channel_id, cumulative_amount FROM channels")).toEqual([
      { channel_id: channelId, cumulative_amount: "4000" },
    ]);
  });

  it("skips a legacy path that is channels.db itself", async () => {
    const home = await useTempHome();
    await upsertSessionRecord(current());
    const before = await allChannels();
    const path = legacySessionDbPaths()[1]!;
    await symlink(join(home, ".tempo", "wallet", "channels.db"), path);
    const warn = vi.spyOn(console, "error");

    await ensureChannelsTable();

    expect(warn).not.toHaveBeenCalled();
    expect(await allChannels()).toEqual(before);
    expect(
      await querySql("SELECT name FROM sqlite_master WHERE name = 'legacy_session_imports'"),
    ).toEqual([]);
  });

  it("imports each database once, so a channel deleted since never comes back", async () => {
    await useTempHome();
    const path = legacySessionDbPaths()[2]!;
    await seedLegacy(path, "sessions", [{ channel_id: channelId, origin, chain_id: 42431 }]);
    await ensureChannelsTable();
    expect(await querySql("SELECT real_path FROM legacy_session_imports")).toEqual([
      { real_path: await realpath(path) },
    ]);

    // The channel is closed or invalidated and deleted, then an older CLI changes the database.
    await runSql("DELETE FROM channels");
    await seedLegacy(path, "sessions", [{ channel_id: otherChannelId, origin: otherOrigin }]);
    await runProcess(sqlite3, [
      path,
      `UPDATE sessions SET cumulative_amount = '3000', last_used_at = 20 WHERE channel_id = '${channelId}'`,
    ]);

    await ensureChannelsTable();
    expect(await allChannels()).toEqual([]);
    expect((await listSessions()).sessions).toEqual([]);
    await expectKept(path, "sessions", 2);
  });

  it.each([
    { name: "a symlink", alias: symlink },
    { name: "a hard link", alias: link },
  ])("skips a database already imported when $name reaches it", async ({ alias }) => {
    await useTempHome();
    const [, imported, other] = legacySessionDbPaths();
    await seedLegacy(imported!, "sessions", [{ channel_id: channelId, origin }]);
    await ensureChannelsTable();
    await runSql("DELETE FROM channels");

    await alias(imported!, other!);
    await ensureChannelsTable();

    expect(await allChannels()).toEqual([]);
  });

  it("gives a placeholder from orphan discovery the legacy record's identity", async () => {
    await useTempHome();
    await upsertSessionRecord(
      current({
        authorized_signer: "0x0000000000000000000000000000000000000000",
        challenge_echo: "{}",
        last_used_at: 1_000,
        origin: "",
        payee: "0x0000000000000000000000000000000000000000",
        request_url: "",
        salt: "0x00",
        state: "orphaned",
      }),
    );
    await seedLegacy(legacySessionDbPaths()[2]!, "sessions", [{ channel_id: channelId, origin }]);

    await ensureChannelsTable();

    expect(await records()).toEqual([
      expect.objectContaining({
        ...copied({ channel_id: channelId, origin }, "sessions"),
        accepted_cumulative: 2_000n,
        last_used_at: 1_000,
        server_spent: 2_000n,
      }),
    ]);
  });

  it("copies every legacy database under concurrent runs", async () => {
    await useTempHome();
    const paths = legacySessionDbPaths();
    await seedLegacy(paths[0]!, "channels", [{ channel_id: channelId, origin }]);
    await seedLegacy(paths[1]!, "presto", [
      { channel_id: otherChannelId, origin: otherOrigin, closing: readyAt },
    ]);

    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, () => ensureChannelsTable()),
    );

    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    expect(await records()).toEqual([
      expect.objectContaining(copied({ channel_id: channelId, origin }, "channels")),
      expect.objectContaining(
        copied({ channel_id: otherChannelId, origin: otherOrigin, closing: readyAt }, "presto"),
      ),
    ]);
    await expectKept(paths[0]!, "channels", 1);
    await expectKept(paths[1]!, "presto", 1);
  });

  it("lists copied sessions from concurrent CLI runs", async () => {
    await useTempHome();
    await seedLegacy(legacySessionDbPaths()[1]!, "presto", [
      { channel_id: channelId, origin, chain_id: 42431 },
      { channel_id: otherChannelId, origin: otherOrigin, chain_id: 42431, closing: readyAt },
    ]);

    const runs = await Promise.all(Array.from({ length: concurrency }, () => listSessions()));

    for (const { sessions } of runs)
      expect(sessions).toEqual([
        expect.objectContaining({ channel_id: channelId.toLowerCase(), status: "active" }),
        expect.objectContaining({ channel_id: otherChannelId, status: "closing" }),
      ]);
  });

  it("copies nothing from an empty legacy file and leaves it", async () => {
    await useTempHome();
    const path = legacySessionDbPaths()[0]!;
    await writeFile(path, "");

    await ensureChannelsTable();

    expect(await allChannels()).toEqual([]);
    expect(await readdir(dirname(path))).toContain(basename(path));
    expect(await querySql("SELECT real_path FROM legacy_session_imports")).toEqual([
      { real_path: await realpath(path) },
    ]);
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
  ])(
    "leaves a legacy file that $name, warns once a command, and retries it",
    async ({ seed, reason }) => {
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
      expect(await readdir(dirname(path))).toContain(basename(path));
      expect(await allChannels()).toEqual([]);

      // A later command tries it again.
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
      await importLegacySessions();
      expect(warn).toHaveBeenCalledTimes(2);
    },
  );
});
