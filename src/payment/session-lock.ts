import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { walletError } from "../shared/errors.js";
import { sqlite3 } from "../shared/process.js";
import { sleep } from "../shared/utils.js";

export async function withSessionLock<T>(url: string, fn: () => Promise<T>): Promise<T> {
  return withFileLock(lockPath(url), "session lock", fn);
}

const lockTimeoutMs = 30_000;

/**
 * Runs `fn` while holding the exclusive lock on the file at `path`, which is created on first use
 * and never removed. It waits while another process or call holds it, and fails with
 * `E_POLL_TIMEOUT` naming `label` after 30 seconds. Errors from `fn` propagate unchanged.
 *
 * A `sqlite3` child holds the lock as an open `BEGIN EXCLUSIVE` transaction on `path`, an OS file
 * lock the kernel releases when the child exits. The child exits when its stdin closes: on release,
 * or when this process dies. So a lock is never left behind, and none is ever reclaimed or deleted.
 */
export async function withFileLock<T>(
  path: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const release = await acquire(path, label);
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function acquire(path: string, label: string) {
  const deadline = Date.now() + lockTimeoutMs;
  while (true) {
    const release = await tryLock(path, Math.max(0, deadline - Date.now()));
    if (release) return release;
    if (Date.now() > deadline)
      throw walletError({
        code: "E_POLL_TIMEOUT",
        message: `Timed out waiting for ${label}: ${path}`,
      });
    await sleep(100);
  }
}

/**
 * Starts a `sqlite3` child that takes the lock at `path`, its busy handler retrying for up to
 * `waitMs` while another holds it. Resolves with the function that releases the lock, or with
 * `undefined` if it is still held.
 */
function tryLock(path: string, waitMs: number) {
  return new Promise<(() => Promise<void>) | undefined>((resolve, reject) => {
    // Detached into its own session, the child gets none of the terminal's signals, such as the
    // hangup that ends sqlite3, so it outlives `fn` unless it is killed by pid.
    const child = spawn(sqlite3, ["-bail", path], { detached: true, windowsHide: true });
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
    child.on("error", (error) =>
      reject(new Error(`Failed to run sqlite3 for the lock at ${path}: ${error.message}`)),
    );
    child.on("close", (code) => {
      if (/database is locked/.test(stderr)) resolve(undefined);
      else reject(new Error(`sqlite3 failed to lock ${path}: ${stderr.trim() || `exit ${code}`}`));
    });
    // A child that has exited fails the write; its exit settles the promise instead.
    child.stdin.on("error", () => undefined);
    // `.print` runs only if the transaction began, as `-bail` exits at the first error.
    child.stdin.write(`.timeout ${waitMs}\nBEGIN EXCLUSIVE;\n.print locked\n`);
  });
}

// Lock files are never deleted, so origins hash into 256 of them. Origins that share one only
// wait for each other.
function lockPath(url: string) {
  const origin = new URL(url).origin;
  const slot = createHash("sha256").update(origin).digest("hex").slice(0, 2);
  return join(homedir(), ".tempo", "wallet", "session-locks", `${slot}.lock`);
}
