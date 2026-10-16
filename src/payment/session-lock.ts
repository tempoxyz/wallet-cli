import { mkdir, open, readdir, stat, unlink, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { walletError } from "../shared/errors.js";
import { sleep } from "../shared/utils.js";
import { removeUnheldLegacyLocks } from "./legacy-locks.js";

/**
 * Runs `fn` holding the session lock for `url`'s origin. Each origin's lock is a file that exists
 * only while held, so first the locks of processes killed while holding one, and the lock files
 * earlier releases never removed, are cleaned up.
 */
export async function withSessionLock<T>(url: string, fn: () => Promise<T>): Promise<T> {
  await removeStaleSessionLocks();
  await removeUnheldLegacyLocks();
  return withFileLock(lockPath(url), "session lock", fn);
}

/**
 * Deletes every session lock whose holder exited without releasing it, as when it was killed
 * mid-request, for any origin. A lock a live process holds is kept. Best effort: a lock that
 * cannot be read or deleted is left for the next run.
 */
export async function removeStaleSessionLocks() {
  const dir = sessionLocksDir();
  const names = await readdir(dir).catch((): string[] => []);
  await Promise.all(
    names.map((name) => {
      const path = join(dir, name);
      if (name.endsWith(".lock")) return removeStaleLock(path).catch(() => false);
      if (name.endsWith(turnSuffix)) return removeAbandonedTurn(path);
      return undefined;
    }),
  );
}

/**
 * Runs `fn` while holding the lock file at `path`, created exclusively and removed afterwards. It
 * waits for another process's lock, taking it over once that process has exited, and fails with
 * `E_POLL_TIMEOUT` naming `label` after 30 seconds.
 */
export async function withFileLock<T>(
  path: string,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await acquireLock(path, label);
  try {
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
    return await fn();
  } finally {
    await releaseLock(path, handle);
  }
}

async function acquireLock(path: string, label: string) {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      return await open(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (await removeStaleLock(path)) continue;
    if (Date.now() > deadline)
      throw walletError({
        code: "E_POLL_TIMEOUT",
        message: `Timed out waiting for ${label}: ${path}`,
      });
    await sleep(100);
  }
}

/** Closes the lock and deletes its file, unless the file at `path` is no longer this lock. */
async function releaseLock(path: string, handle: FileHandle) {
  const { ino } = await handle.stat();
  await handle.close();
  const current = await stat(path).catch(() => undefined);
  if (current?.ino === ino) await unlink(path).catch(() => undefined);
}

// A new lock is briefly empty between open() and the pid write, so a lock
// without a pid only counts as abandoned once it is older than this.
const unreadablePidGraceMs = 5_000;

/** The file a process holds for its turn to delete one stale lock: `<lock>.reclaim`. */
const turnSuffix = ".reclaim";

/**
 * Deletes the lock at `path` if its holder has exited, or if it has had no pid for longer than
 * `unreadablePidGraceMs`. Processes take turns, each reading the lock again on its turn: two
 * that read the same stale lock could otherwise both delete "it", the second deleting the lock a
 * new holder took after the first. Resolves `true` when it deleted the lock.
 */
async function removeStaleLock(path: string) {
  const lock = await readLock(path);
  if (!lock || !isStale(lock)) return false;

  const turnPath = `${path}${turnSuffix}`;
  const turn = await open(turnPath, "wx").catch(() => undefined);
  if (!turn) {
    await removeAbandonedTurn(turnPath);
    return false;
  }
  try {
    // Until this turn ends, only this process deletes the lock, and none can take it while it exists.
    const current = await readLock(path);
    if (!current || !isStale(current)) return false;
    await unlink(path);
    return true;
  } finally {
    await turn.close();
    await unlink(turnPath).catch(() => undefined);
  }
}

/** Deletes a turn its process held for longer than any turn takes, so it exited during it. */
async function removeAbandonedTurn(path: string) {
  const stats = await stat(path).catch(() => undefined);
  if (stats && Date.now() - stats.mtimeMs >= unreadablePidGraceMs)
    await unlink(path).catch(() => undefined);
}

type LockFile = { mtimeMs: number; text: string };

/** The lock file at `path`, or `undefined` when it cannot be read, as once its holder removed it. */
async function readLock(path: string): Promise<LockFile | undefined> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return undefined;
  try {
    const { mtimeMs } = await handle.stat();
    return { mtimeMs, text: await handle.readFile("utf8") };
  } finally {
    await handle.close();
  }
}

function isStale(lock: LockFile) {
  const pid = Number(lock.text.split("\n")[0]);
  if (!Number.isInteger(pid) || pid <= 0) return Date.now() - lock.mtimeMs >= unreadablePidGraceMs;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function sessionLocksDir() {
  return join(homedir(), ".tempo", "wallet", "session-locks");
}

function lockPath(url: string) {
  const origin = new URL(url).origin;
  const key = origin.replace(/[^A-Za-z0-9.-]/g, "_");
  return join(sessionLocksDir(), `${key}.lock`);
}
