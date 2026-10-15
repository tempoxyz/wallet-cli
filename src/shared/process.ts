import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";
import { createInterface } from "node:readline/promises";

export function openExternal(url: string) {
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

/** Asks a yes/no question on stderr. Only `y` or `yes` confirms; input that ends declines. */
export async function confirm(question: string) {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const closed = new Promise<string>((resolve) => prompt.once("close", () => resolve("")));
  try {
    const answer = await Promise.race([prompt.question(`${question} [y/N] `), closed]);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

/** The sqlite3 binary the session store runs, looked up on PATH. */
export const sqlite3 = "sqlite3";

/** Runs `command` and resolves with its stdout; `signal` kills it and rejects. */
export function runProcess(
  command: string,
  args: readonly string[],
  options: { signal?: AbortSignal | undefined } = {},
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.signal ? { signal: options.signal } : {}),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
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

/** Runs a query against channels.db and returns its rows as parsed `sqlite3 -json` output. */
export async function querySql(sql: string): Promise<unknown> {
  return JSON.parse((await runSqlite(["-json"], sql)) || "[]");
}

function runSqlite(options: readonly string[], sql: string) {
  // `.timeout` sets the busy timeout without printing a row, unlike `PRAGMA busy_timeout`.
  return runProcess(sqlite3, [
    ...options,
    "-cmd",
    `.timeout ${sqliteBusyTimeoutMs}`,
    channelsDbPath(),
    sql,
  ]);
}

export function channelsDbPath() {
  return join(homedir(), ".tempo", "wallet", "channels.db");
}

export function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
