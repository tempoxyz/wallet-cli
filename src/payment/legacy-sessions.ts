import { access, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  channelsDbPath,
  maxDecimalSql,
  queryReadOnlySql,
  runSql,
  sqlString,
} from "../shared/process.js";
import { getArray, getRecord, stringValue } from "../shared/utils.js";
import { withFileLock } from "./session-lock.js";

/**
 * Session databases of earlier releases (the Rust CLI), whose sessions `channels.db` does not hold.
 * They have the `channels` table of `channels.db` before its later columns, or the older `sessions`
 * table: one row per origin, naming the token `currency` and the payee `recipient`.
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

// A path whose migration failed in this process, so it warns once rather than on every store access.
const failed = new Set<string>();

/**
 * Moves the sessions of each legacy session database into `channels.db`, then renames the database
 * to `<name>.migrated`, keeping it. A channel `channels.db` already holds keeps the record used
 * more recently, with the higher of each amount, so a rerun changes nothing. Concurrent runs take
 * a lock file for the legacy databases, and the write waits out other writers to `channels.db`.
 * A database that cannot be migrated is left in place with a warning, and retried by the next run.
 */
export async function migrateLegacySessions() {
  const pending = await existing(legacySessionDbPaths().filter((path) => !failed.has(path)));
  if (pending.length === 0) return;
  const lock = join(dirname(channelsDbPath()), "legacy-sessions.lock");
  await withFileLock(lock, "session migration lock", async () => {
    // Another run may have migrated a database while this one waited for the lock.
    for (const path of await existing(pending))
      await migrateLegacyDb(path).catch((error: unknown) => warn([path], error));
  }).catch((error: unknown) => warn(pending, error));
}

function warn(paths: readonly string[], error: unknown) {
  for (const path of paths) failed.add(path);
  const reason = error instanceof Error ? error.message.trim() : String(error);
  console.error(
    `Warning: could not move the sessions stored in ${paths.join(", ")} into ${channelsDbPath()}; kept in place to retry on the next run: ${reason}`,
  );
}

async function migrateLegacyDb(path: string) {
  const inserts: string[] = [];
  for (const [table, available] of await legacyTables(path)) {
    const insert = insertSql(table, available);
    if (!insert) return warn([path], `its ${table} table lacks a column a session needs`);
    inserts.push(insert);
  }
  if (inserts.length > 0) {
    // Read-only, so the legacy database is never written, or created if it went missing.
    const attach = `ATTACH ${sqlString(`${pathToFileURL(path).href}?mode=ro`)} AS legacy`;
    await runSql(`${attach};\nBEGIN IMMEDIATE;\n${inserts.join(";\n")};\nCOMMIT;`);
  }
  await markMigrated(path);
}

/** The legacy session tables in the database at `path`, and their columns. */
async function legacyTables(path: string) {
  const rows = getArray(
    await queryReadOnlySql(
      path,
      `SELECT m.name AS tbl, p.name AS col
       FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p
       WHERE m.type = 'table' AND m.name IN ('channels', 'sessions')`,
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
 * Copies `table`'s sessions into `channels`. For a channel already there, the amounts keep the
 * higher value and every other column comes from the record with the later `last_used_at`; on a
 * tie the stored record wins. `undefined` when the table lacks a column a session needs.
 */
function insertSql(table: string, available: ReadonlySet<string>) {
  const values = columns.map((column) => valueSql(column, available));
  if (values.includes(undefined)) return undefined;
  const updates = columns
    .filter(({ name }) => name !== "channel_id")
    .map(({ name }) =>
      amounts.has(name)
        ? `${name} = ${maxDecimalSql(`channels.${name}`, `excluded.${name}`)}`
        : `${name} = CASE WHEN excluded.last_used_at > channels.last_used_at THEN excluded.${name} ELSE channels.${name} END`,
    );
  return `INSERT INTO main.channels (version, ${columns.map(({ name }) => name).join(", ")})
    SELECT 1, ${values.join(", ")} FROM legacy.${table}
    WHERE LENGTH(channel_id) = 66 AND channel_id LIKE '0x%'
    ON CONFLICT(channel_id) DO UPDATE SET ${updates.join(",\n      ")}`;
}

/** The legacy expression for `column`, or its fallback when the table lacks it. */
function valueSql({ name, from, fallback }: Column, available: ReadonlySet<string>) {
  const source = from.find((column) => available.has(column));
  if (source === undefined) return fallback;
  if (name === "channel_id") return `LOWER(${source})`;
  return amounts.has(name) ? `CAST(${source} AS TEXT)` : source;
}

/**
 * Renames the database, and its WAL files so it stays readable, to `<name>.migrated`, or to a
 * timestamped name when an earlier migration already took that one. The WAL files move first, so
 * an interrupted rename leaves the database where the next run migrates it again.
 */
async function markMigrated(path: string) {
  const target = (await existing([`${path}.migrated`])).length
    ? `${path}.migrated-${Date.now()}`
    : `${path}.migrated`;
  for (const suffix of ["-wal", "-shm"])
    await rename(`${path}${suffix}`, `${target}${suffix}`).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  await rename(path, target);
}

async function existing(paths: readonly string[]) {
  const found = await Promise.all(
    paths.map((path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    ),
  );
  return paths.filter((_, index) => found[index]);
}
