import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  channelsDbPath,
  existingDbUri,
  maxDecimalSql,
  queryExistingDbSql,
  querySql,
  runSql,
  sqlString,
} from "../shared/process.js";
import { getArray, getRecord, stringValue } from "../shared/utils.js";

/**
 * Session databases of earlier releases (the Rust CLI), whose sessions `channels.db` does not hold.
 * They have the `channels` table of `channels.db` before its later columns, or the older `sessions`
 * table: one row per origin, naming the token `currency` and the payee `recipient`. presto's first
 * `sessions` table had no close state; it kept each requested close in `pending_closes`.
 */
export function legacySessionDbPaths() {
  const tempo = join(homedir(), ".tempo");
  return [
    join(tempo, "channels.db"),
    join(tempo, "sessions.db"),
    join(tempo, "wallet", "sessions.db"),
  ];
}

type Column = { name: string; from: readonly string[]; fallback?: string };

/**
 * Each `channels` column, the legacy columns that hold it in order of preference, and its value
 * when none does. A legacy table without a column that has no fallback is not a session table.
 */
const columns: readonly Column[] = [
  { name: "channel_id", from: ["channel_id"] },
  { name: "origin", from: ["origin"] },
  { name: "request_url", from: ["request_url"], fallback: "''" },
  { name: "chain_id", from: ["chain_id"] },
  { name: "escrow_contract", from: ["escrow_contract"] },
  { name: "token", from: ["token", "currency"] },
  { name: "payee", from: ["payee", "recipient"] },
  { name: "payer", from: ["payer"] },
  { name: "authorized_signer", from: ["authorized_signer"] },
  { name: "salt", from: ["salt"] },
  { name: "deposit", from: ["deposit"] },
  { name: "cumulative_amount", from: ["cumulative_amount"] },
  { name: "accepted_cumulative", from: ["accepted_cumulative"], fallback: "'0'" },
  { name: "server_spent", from: ["server_spent"], fallback: "'0'" },
  { name: "challenge_echo", from: ["challenge_echo"] },
  { name: "state", from: ["state"], fallback: "'active'" },
  { name: "close_requested_at", from: ["close_requested_at"], fallback: "0" },
  { name: "grace_ready_at", from: ["grace_ready_at"], fallback: "0" },
  { name: "created_at", from: ["created_at"] },
  { name: "last_used_at", from: ["last_used_at"] },
  { name: "session_protocol", from: ["session_protocol"], fallback: "'v1'" },
  { name: "descriptor_json", from: ["descriptor_json"], fallback: "NULL" },
];

/** Amounts that only grow: a merge keeps the higher, as every other write to `channels.db` does. */
const amounts = new Set(["deposit", "cumulative_amount", "accepted_cumulative", "server_spent"]);

/** Close times, which a merge also never lowers: a requested close stays requested. */
const closeTimes = new Set(["close_requested_at", "grace_ready_at"]);

/** How far a channel's close has gone; a merge keeps the furthest, so a close is never undone. */
function closeRankSql(state: string) {
  return `CASE ${state} WHEN 'closing' THEN 1 WHEN 'finalizable' THEN 2 WHEN 'finalized' THEN 3 ELSE 0 END`;
}

// The signature each legacy database had when this process last imported it, or found it imported.
const imported = new Map<string, string>();

// When a legacy database last failed to import in this process. It is retried once this long has
// passed, so one command warns about it once and a long-lived MCP server still retries it.
const failedAt = new Map<string, number>();
const retryAfterMs = 60_000;

/**
 * Copies the sessions of each legacy session database into `channels.db`, leaving the legacy files
 * in place. `channels.db` records each database's size and modification time, and its WAL's, when
 * it was imported, and a database is read again only once they change, as when an older CLI still
 * writes to it. Importing again changes nothing: for a channel `channels.db` already holds, see
 * `insertSql`. A database that cannot be imported is reported on stderr and retried later.
 */
export async function importLegacySessions() {
  const now = Date.now();
  const store = await stat(channelsDbPath()).catch(() => undefined);
  const pending: { path: string; signature: string }[] = [];
  for (const path of legacySessionDbPaths()) {
    if (now - (failedAt.get(path) ?? -Infinity) < retryAfterMs) continue;
    const db = await stat(path).catch(() => undefined);
    // A legacy path that is `channels.db` itself, through a symlink, holds nothing to copy.
    if (!db?.isFile() || (db.dev === store?.dev && db.ino === store.ino)) continue;
    const signature = await fileSignature(path, db);
    if (imported.get(path) !== signature) pending.push({ path, signature });
  }
  if (pending.length === 0) return;

  let recorded: Map<string, string>;
  try {
    recorded = await recordedSignatures();
  } catch (error) {
    for (const { path } of pending) fail(path, error);
    return;
  }
  for (const { path, signature } of pending) {
    const problem =
      recorded.get(path) === signature
        ? undefined
        : await importLegacyDb(path, signature).catch((error: unknown) => errorMessage(error));
    if (problem !== undefined) fail(path, problem);
    else {
      imported.set(path, signature);
      failedAt.delete(path);
    }
  }
}

/**
 * Copies the sessions of the database at `path` into `channels.db`, then records `signature`, its
 * signature before it was read. Resolves the reason when it cannot.
 */
async function importLegacyDb(path: string, signature: string) {
  const tables = await legacyTables(path);
  const inserts: string[] = [];
  for (const table of ["channels", "sessions"]) {
    const available = tables.get(table);
    if (!available) continue;
    const insert = insertSql(table, available, tables.get("pending_closes"));
    if (!insert) return `its ${table} table lacks a column a session needs`;
    inserts.push(insert);
  }
  // One statement per call, each applied whole or not at all, and the signature only after all of
  // them: the shell runs the rest of a script after a statement in it fails.
  const attach = `ATTACH ${sqlString(existingDbUri(path))} AS legacy;`;
  for (const insert of inserts) await runSql(`${attach}\n${insert}`);
  // A database written while it was read changed its signature since, so the next run reads it again.
  await runSql(`INSERT INTO legacy_session_imports (path, signature)
    VALUES (${sqlString(path)}, ${sqlString(signature)})
    ON CONFLICT(path) DO UPDATE SET signature = excluded.signature`);
  return undefined;
}

/** The size and modification time of the database at `path`, `db`, and of its WAL. */
async function fileSignature(path: string, db: Stats) {
  const wal = await stat(`${path}-wal`).catch(() => undefined);
  return `${db.size}:${db.mtimeMs}${wal ? ` wal ${wal.size}:${wal.mtimeMs}` : ""}`;
}

/** The signature `channels.db` recorded for each legacy database it imported. */
async function recordedSignatures() {
  const rows = getArray(
    await querySql(`CREATE TABLE IF NOT EXISTS legacy_session_imports (
        path TEXT PRIMARY KEY,
        signature TEXT NOT NULL
      );
      SELECT path, signature FROM legacy_session_imports`),
  );
  return new Map(
    rows.map((row) => {
      const item = getRecord(row);
      return [stringValue(item.path), stringValue(item.signature)] as const;
    }),
  );
}

/** The legacy session tables in the database at `path`, and their columns. */
async function legacyTables(path: string) {
  const rows = getArray(
    await queryExistingDbSql(
      path,
      `SELECT m.name AS tbl, p.name AS col
       FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p
       WHERE m.type = 'table' AND m.name IN ('channels', 'sessions', 'pending_closes')`,
    ),
  );
  const tables = new Map<string, Set<string>>();
  for (const row of rows) {
    const item = getRecord(row);
    const table = stringValue(item.tbl);
    tables.set(table, (tables.get(table) ?? new Set()).add(stringValue(item.col)));
  }
  return tables;
}

/**
 * Copies `table`'s sessions into `channels`, a channel in `pending_closes` as closing until its
 * `ready_at`. For a channel `channels` already holds, amounts and close times keep the higher
 * value, the state the further close, and every other column comes from the record with the later
 * `last_used_at`; on a tie the stored record wins. `undefined` when `table` lacks a column a
 * session needs.
 */
function insertSql(
  table: string,
  available: ReadonlySet<string>,
  pendingCloses: ReadonlySet<string> | undefined,
) {
  const values = columns.map((column) => valueSql(column, available));
  if (values.includes(undefined)) return undefined;
  const closes = pendingCloses?.has("channel_id") && pendingCloses.has("ready_at");
  const selected = columns.map(({ name }, index) => {
    const value = values[index];
    if (closes && name === "state")
      return `CASE WHEN pc.channel_id IS NULL THEN ${value} ELSE 'closing' END`;
    if (closes && name === "grace_ready_at") return `COALESCE(pc.ready_at, ${value})`;
    return value;
  });

  const newer = "excluded.last_used_at > channels.last_used_at";
  const updates = columns
    .filter(({ name }) => name !== "channel_id")
    .map(({ name }) => {
      if (amounts.has(name))
        return `${name} = ${maxDecimalSql(`channels.${name}`, `excluded.${name}`)}`;
      if (closeTimes.has(name)) return `${name} = MAX(channels.${name}, excluded.${name})`;
      if (name === "state")
        return `state = CASE
          WHEN ${closeRankSql("excluded.state")} > ${closeRankSql("channels.state")} THEN excluded.state
          WHEN ${closeRankSql("excluded.state")} < ${closeRankSql("channels.state")} THEN channels.state
          WHEN ${newer} THEN excluded.state
          ELSE channels.state
        END`;
      return `${name} = CASE WHEN ${newer} THEN excluded.${name} ELSE channels.${name} END`;
    });

  return `INSERT INTO main.channels (version, ${columns.map(({ name }) => name).join(", ")})
    SELECT 1, ${selected.join(", ")}
    FROM legacy.${table} AS s
    ${closes ? "LEFT JOIN legacy.pending_closes AS pc ON LOWER(pc.channel_id) = LOWER(s.channel_id)" : ""}
    WHERE LENGTH(s.channel_id) = 66 AND s.channel_id LIKE '0x%'
    ON CONFLICT(channel_id) DO UPDATE SET ${updates.join(",\n      ")}`;
}

/** The legacy expression for `column`, or its fallback when the table lacks it. */
function valueSql({ name, from, fallback }: Column, available: ReadonlySet<string>) {
  const source = from.find((column) => available.has(column));
  if (source === undefined) return fallback;
  // The id as `channels` already spells it, so a stored channel conflicts whatever its case.
  if (name === "channel_id")
    return `COALESCE(
      (SELECT c.channel_id FROM main.channels AS c WHERE LOWER(c.channel_id) = LOWER(s.${source})),
      LOWER(s.${source})
    )`;
  return amounts.has(name) ? `CAST(s.${source} AS TEXT)` : `s.${source}`;
}

function fail(path: string, error: unknown) {
  failedAt.set(path, Date.now());
  console.error(
    `Warning: could not copy the sessions stored in ${path} into ${channelsDbPath()}; the file is left as it is and retried later: ${errorMessage(error)}`,
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.trim() : String(error);
}
