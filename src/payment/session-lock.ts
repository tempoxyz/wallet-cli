import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { devNull, homedir } from "node:os";
import { dirname, join } from "node:path";

import { CtaError } from "../cli/incur-compat.js";
import { commandError, walletError } from "../shared/errors.js";
import { shellQuote } from "../shared/next.js";
import { spawnError, sqlite3, startProcess } from "../shared/process.js";
import { sleep } from "../shared/utils.js";

type Release = () => Promise<void>;

const lockTimeoutMs = 30_000;

/**
 * Runs `fn` holding the session lock for `url`'s origin, as `withFileLock` does. Without sqlite3 on
 * PATH it fails instead of falling back, since session payments need sqlite3 anyway. It fails with
 * `E_PAYMENT`, as the session store did, so `--payment-intent auto` still offers a charge.
 */
export async function withSessionLock<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const release = await kernelLock(lockPath(url), "session lock");
  if (!release) throw sqlite3MissingError();
  return runHolding(release, fn);
}

/**
 * Runs `fn` while holding the exclusive lock on the file at `path`, which is created on first use
 * and never removed. It waits while another process or call holds it, and fails with
 * `E_POLL_TIMEOUT` naming `label` after 30 seconds, or with `E_RUNTIME` when sqlite3 cannot take it.
 * Errors from `fn` propagate unchanged.
 *
 * A `sqlite3` child holds the lock as an open `BEGIN EXCLUSIVE` transaction on `path`, an OS file
 * lock the kernel releases when the child exits. The child exits when its stdin closes: on release,
 * or when this process dies. So a lock is never left behind, and none is ever reclaimed or deleted.
 * Without sqlite3 on PATH, it takes the pid file at `${path}.pid` instead; see `pidFileLock`.
 */
export async function withFileLock<T>(
  path: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const release = (await kernelLock(path, label)) ?? (await pidFileLock(`${path}.pid`, label));
  return runHolding(release, fn);
}

async function runHolding<T>(release: Release, fn: () => Promise<T>) {
  try {
    return await fn();
  } finally {
    await release();
  }
}

/** Takes the sqlite3-held lock at `path`; resolves `undefined` when sqlite3 is not on PATH. */
async function kernelLock(path: string, label: string) {
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + lockTimeoutMs;
  while (true) {
    const attempt = await tryLock(path, Math.max(0, deadline - Date.now()));
    if (attempt === "no sqlite3") return undefined;
    if (attempt !== "busy") return attempt;
    if (Date.now() > deadline) throw timeoutError(label, path);
    await sleep(100);
  }
}

/**
 * Starts a `sqlite3` child that takes the lock at `path`, its busy handler retrying for up to
 * `waitMs` while another holds it. Resolves with the function that releases the lock, `"busy"` if
 * it is still held, or `"no sqlite3"` if sqlite3 is not on PATH. Rejects with `E_RUNTIME` when
 * sqlite3 cannot start, retryable when that is transient, or fails to take the lock.
 */
function tryLock(path: string, waitMs: number) {
  return new Promise<Release | "busy" | "no sqlite3">((resolve, reject) => {
    // Detached into its own session, the child gets none of the terminal's signals, such as the
    // hangup that ends sqlite3, so it outlives `fn` unless it is killed by pid.
    // `-init` skips the user's sqliterc, which could turn bail off or print anything.
    const child = startProcess(
      sqlite3,
      ["-init", devNull, "-bail", path],
      { detached: true, windowsHide: true },
      (error) => {
        if (error.code === "ENOENT") resolve("no sqlite3");
        else
          reject(
            spawnError(error, `Failed to run sqlite3 for the lock at ${path}: ${error.message}`),
          );
      },
    );
    if (!child) return;
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!stdout.split(/\r?\n/).includes("locked")) return;
      resolve(async () => {
        child.stdin.end();
        await exited;
      });
    });
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("close", (code) => {
      if (/database is locked/.test(stderr)) resolve("busy");
      else
        reject(
          walletError({
            code: "E_RUNTIME",
            message: `sqlite3 failed to lock ${path}: ${stderr.trim() || `exit ${code}`}`,
          }),
        );
    });
    // A child that has exited fails the write; its exit settles the promise instead.
    child.stdin.on("error", () => undefined);
    // `locked` comes only from the SELECT after a BEGIN that took the lock: with bail on, the
    // child exits at the first error, and an error also skips the rest of its line.
    child.stdin.write(`.bail on\n.timeout ${waitMs}\nBEGIN EXCLUSIVE; SELECT 'locked';\n`);
  });
}

/**
 * The lock `withFileLock` takes without sqlite3: `path`, created exclusively with the holder's pid
 * and deleted by the holder on release, or when a signal ends it. It is never taken over, since
 * waiters that each find its holder dead and delete it can delete each other's: one whose holder
 * has exited, as after SIGKILL, fails with `E_RUNTIME` naming it, for the user to remove.
 */
async function pidFileLock(path: string, label: string): Promise<Release> {
  // The signal handler is installed before the file is created and removed after it is deleted.
  // Signal handlers run between event loop turns, and the file is created and recorded, or deleted
  // and forgotten, within one turn, so a signal cannot leave it behind. It deletes the file only
  // while the path still names the one this process created.
  let created: FileId | undefined;
  const remove = () => {
    if (created && sameFile(path, created)) rmSync(path, { force: true });
    created = undefined;
  };
  const unwatch = onEndingSignal(remove);
  try {
    const deadline = Date.now() + lockTimeoutMs;
    while (true) {
      created = createPidFile(path);
      if (created)
        return async () => {
          remove();
          unwatch();
        };
      const pid = await exitedHolder(path);
      if (pid !== undefined) throw staleLockError(label, path, pid);
      if (Date.now() > deadline) throw timeoutError(label, path);
      await sleep(100);
    }
  } catch (error) {
    unwatch();
    throw error;
  }
}

type FileId = { dev: bigint; ino: bigint };

/** Creates the file at `path` holding this process's pid; `undefined` if it already exists. */
function createPidFile(path: string): FileId | undefined {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  try {
    const { dev, ino } = fstatSync(fd, { bigint: true });
    writeFileSync(fd, `${process.pid}\n`);
    return { dev, ino };
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  } finally {
    closeSync(fd);
  }
}

function sameFile(path: string, id: FileId) {
  const stats = statSync(path, { bigint: true, throwIfNoEntry: false });
  return stats?.dev === id.dev && stats.ino === id.ino;
}

const endingSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Until the returned function is called, runs `cleanup` when a signal that ends the process by
 * default arrives, then raises the signal again so it still does.
 */
function onEndingSignal(cleanup: () => void) {
  const unwatch = () => {
    for (const signal of endingSignals) process.removeListener(signal, onSignal);
  };
  const onSignal = (signal: NodeJS.Signals) => {
    unwatch();
    cleanup();
    process.kill(process.pid, signal);
  };
  for (const signal of endingSignals) process.on(signal, onSignal);
  return unwatch;
}

/** The pid in the lock file at `path`, if that process has exited. */
async function exitedHolder(path: string) {
  const pid = Number((await readFile(path, "utf8").catch(() => "")).split("\n")[0]);
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
    return undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? pid : undefined;
  }
}

function timeoutError(label: string, path: string) {
  return walletError({
    code: "E_POLL_TIMEOUT",
    message: `Timed out waiting for ${label}: ${path}`,
  });
}

// incur prefixes every cta command with the CLI's name, so removing the file can only be named in
// the message.
function staleLockError(label: string, path: string, pid: number) {
  return walletError({
    code: "E_RUNTIME",
    message: `The ${label} ${path} was left by process ${pid}, which has exited. Once no tempo process is running, remove it with 'rm ${shellQuote(path)}' and retry.`,
    retryable: false,
  });
}

function sqlite3MissingError() {
  return new CtaError(
    commandError(
      "E_PAYMENT",
      "sqlite3 was not found on PATH. Payment sessions need it: install sqlite3, then retry.",
      "tempo wallet doctor",
    ),
  );
}

// One lock file per origin, named by its hash. They are never deleted, so each origin paid leaves
// one empty file.
function lockPath(url: string) {
  const origin = new URL(url).origin;
  const name = createHash("sha256").update(origin).digest("hex");
  return join(homedir(), ".tempo", "wallet", "session-locks", `${name}.lock`);
}
