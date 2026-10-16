import { spawn } from "node:child_process";
import { devNull, homedir } from "node:os";
import { join } from "node:path";
import { env, platform } from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

/** Opens `url` in the default browser, unless `TEMPO_NO_BROWSER` is set (headless hosts, agents). */
export function openExternal(url: string) {
  if (env.TEMPO_NO_BROWSER) return;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  // Spawning emits an asynchronous error when no browser opener is installed
  // (common on headless VMs). The URL is printed before this best-effort call,
  // so keep the CLI alive and let the user open it elsewhere.
  child.on("error", () => undefined);
  child.unref();
}

/**
 * Asks a yes/no question on stderr. Only `y` or `yes` confirms; input that ends, or Ctrl-C,
 * declines. Callers prompt only when `canPrompt` allows it.
 */
export async function confirm(question: string) {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const closed = new Promise<string>((resolve) => prompt.once("close", () => resolve("")));
  // Without a listener, Ctrl-C only pauses the prompt and leaves the question unanswered.
  prompt.once("SIGINT", () => prompt.close());
  try {
    const answer = await Promise.race([prompt.question(`${question} [y/N] `), closed]);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

/**
 * Whether a person can answer a prompt: the run is not an agent's (incur's `agent`: MCP,
 * `--format`, or stdout not a terminal), and stdin is a terminal too, so piped input cannot.
 */
export function canPrompt(agent: boolean) {
  return !agent && process.stdin.isTTY === true;
}

/** The sqlite3 binary the session store runs, looked up on PATH. */
export const sqlite3 = "sqlite3";

/**
 * Runs `command`, writing `input` to its stdin, and resolves with its stdout; `signal` kills it and
 * rejects.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: { input?: string | undefined; signal?: AbortSignal | undefined } = {},
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.signal ? { signal: options.signal } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    // A command that exits without reading its stdin fails the write; its exit code reports it.
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}

// Concurrent CLI processes share channels.db. Like the Rust CLI's busy_timeout, wait this
// long for another process's lock instead of failing at once with "database is locked".
const sqliteBusyTimeoutMs = 5_000;

export async function runSql(sql: string) {
  await runSqlite([], sql);
}

/**
 * Runs `sql` against channels.db, stopping at its first failing statement, so a
 * `BEGIN; ...; COMMIT;` script applies whole or not at all. `runSql` cannot: the shell runs the
 * rest of a SQL argument after a statement in it fails, even with `-bail`.
 */
export async function runSqlScript(sql: string) {
  // `-init` skips the user's sqliterc, which could turn `-bail` off.
  await runProcess(
    sqlite3,
    ["-init", devNull, "-bail", "-cmd", `.timeout ${sqliteBusyTimeoutMs}`, channelsDbPath()],
    { input: sql },
  );
}

/** Runs a query against channels.db and returns its rows as parsed `sqlite3 -json` output. */
export async function querySql(sql: string): Promise<unknown> {
  return JSON.parse((await runSqlite(["-json"], sql)) || "[]");
}

/** Like `querySql`, against the existing database at `path`; see `existingDbUri`. */
export async function queryExistingDbSql(path: string, sql: string): Promise<unknown> {
  return JSON.parse((await runSqlite(["-json"], sql, existingDbUri(path))) || "[]");
}

/**
 * A URI that opens the database at `path` as any SQLite client does, applying its WAL, but fails
 * instead of creating it when it is missing. Usable in `ATTACH`.
 */
export function existingDbUri(path: string) {
  return `${pathToFileURL(path).href}?mode=rw`;
}

function runSqlite(options: readonly string[], sql: string, database = channelsDbPath()) {
  // `.timeout` sets the busy timeout without printing a row, unlike `PRAGMA busy_timeout`.
  // `-init` skips the user's sqliterc, whose dot-commands could change the output parsed here.
  return runProcess(sqlite3, [
    ...options,
    "-init",
    devNull,
    "-cmd",
    `.timeout ${sqliteBusyTimeoutMs}`,
    database,
    sql,
  ]);
}

export function channelsDbPath() {
  return join(homedir(), ".tempo", "wallet", "channels.db");
}

export function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The larger of two SQL expressions holding non-negative decimal integers stored as text. */
export function maxDecimalSql(left: string, right: string) {
  return `CASE
      WHEN LENGTH(${left}) > LENGTH(${right}) THEN ${left}
      WHEN LENGTH(${left}) < LENGTH(${right}) THEN ${right}
      WHEN ${left} >= ${right} THEN ${left}
      ELSE ${right}
    END`;
}
