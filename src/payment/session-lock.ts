import { open, readFile, stat, unlink, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { sleep } from "../shared/utils.js";

export async function withSessionLock<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const path = lockPath(url);
  await mkdir(dirname(path), { recursive: true });

  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
        return await fn();
      } finally {
        await handle.close();
        await unlink(path).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await removeStaleLock(path)) continue;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for session lock: ${path}`);
      await sleep(100);
    }
  }
}

// The lock file is created by open(path, "wx") and only written afterwards, so
// a freshly created one is legitimately empty for a moment. Give the writer
// this long to record its pid before treating the lock as abandoned.
const unreadablePidGraceMs = 5_000;

async function removeStaleLock(path: string) {
  const text = await readFile(path, "utf8").catch(() => "");
  const pid = Number(text.split("\n")[0]);
  if (!Number.isInteger(pid) || pid <= 0) return await removeAbandonedLock(path);
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") return false;
    await unlink(path).catch(() => undefined);
    return true;
  }
}

// A lock carrying no usable pid cannot be checked against a running process.
// Once it is older than the grace period no writer is still recording one, so
// the holder died between creating the file and writing to it, or the contents
// were truncated. Release it rather than waiting out the deadline on every
// later run.
async function removeAbandonedLock(path: string) {
  const stats = await stat(path).catch(() => undefined);
  if (!stats) return false;
  if (Date.now() - stats.mtimeMs < unreadablePidGraceMs) return false;
  await unlink(path).catch(() => undefined);
  return true;
}

function lockPath(url: string) {
  const origin = new URL(url).origin;
  const key = origin.replace(/[^A-Za-z0-9.-]/g, "_");
  return join(homedir(), ".tempo", "wallet", "session-locks", `${key}.lock`);
}
