import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, stat, unlink, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "incur";

import { withFileLock } from "../payment/session-lock.js";
import { nowSeconds } from "../shared/utils.js";
import { writePrivateFile } from "./store.js";

/** Records older than this are pruned, so their keys can be used again. */
export const idempotencyRecordTtlSeconds = 30 * 86_400;

const recordSchema = z.object({
  key: z.string(),
  wallet: z.string(),
  chain_id: z.number(),
  /** The command and its normalized arguments, which the key is bound to. */
  request: z.record(z.string(), z.string().nullable()),
  /** `submitting` from just before the send until its result is recorded. */
  status: z.enum(["submitting", "success"]),
  tx_hash: z.string().nullable(),
  /** Unix time in seconds. */
  created_at: z.number(),
  /** The command's result, once the send succeeds. */
  result: z.record(z.string(), z.unknown()).nullable(),
});

/** One idempotency key's send, for one wallet on one network. */
export type IdempotencyRecord = z.infer<typeof recordSchema>;

export type IdempotencyScope = { key: string; wallet: string; chainId: number };

/** Each record is its own file, so concurrent sends never rewrite each other's records. */
export function idempotencyDir() {
  return join(homedir(), ".tempo", "wallet", "idempotency");
}

/**
 * The record for `scope`; `undefined` when there is none, and `null` when one exists but cannot be
 * read, as while the process that created it is still writing it.
 */
export async function loadIdempotencyRecord(
  scope: IdempotencyScope,
): Promise<IdempotencyRecord | null | undefined> {
  let text: string;
  try {
    text = await readFile(recordPath(scope), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return parseRecord(text) ?? null;
}

/**
 * Creates `record` unless its key already has one, and returns whether it did. The exclusive
 * create lets only one of several concurrent sends with the same key claim it. The record and its
 * directory entry are flushed to disk before this returns, so a claim made before a send survives
 * a host crash after it.
 */
export async function createIdempotencyRecord(record: IdempotencyRecord) {
  return withRecordsLock(async () => {
    let handle: FileHandle;
    try {
      handle = await open(recordPath(scopeOf(record)), "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      await handle.writeFile(JSON.stringify(record, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(idempotencyDir());
    return true;
  });
}

/** Flushes `dir`'s entries to disk; Windows cannot open a directory to do so. */
async function syncDirectory(dir: string) {
  if (process.platform === "win32") return;
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Replaces the record for `record`'s key. */
export async function saveIdempotencyRecord(record: IdempotencyRecord) {
  await writePrivateFile(recordPath(scopeOf(record)), JSON.stringify(record, null, 2));
}

export async function deleteIdempotencyRecord(record: IdempotencyRecord) {
  await unlink(recordPath(scopeOf(record))).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

/**
 * Deletes records created more than `idempotencyRecordTtlSeconds` before `now`. A record that
 * cannot be read is aged by its modification time.
 */
export async function pruneIdempotencyRecords(now = nowSeconds()) {
  const dir = idempotencyDir();
  const cutoff = now - idempotencyRecordTtlSeconds;
  await withRecordsLock(async () => {
    const names = await readdir(dir);
    await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const path = join(dir, name);
          const text = await readFile(path, "utf8").catch(() => undefined);
          const createdAt =
            (text === undefined ? undefined : parseRecord(text)?.created_at) ??
            (await stat(path).then(
              (info) => info.mtimeMs / 1000,
              () => undefined,
            ));
          if (createdAt !== undefined && createdAt < cutoff)
            await unlink(path).catch(() => undefined);
        }),
    );
  });
}

/**
 * Runs `fn` holding the records lock. Pruning and claims take it, so a prune cannot delete a key's
 * expired record after another run has replaced it with a new claim.
 */
async function withRecordsLock<T>(fn: () => Promise<T>) {
  await mkdir(idempotencyDir(), { recursive: true, mode: 0o700 });
  return withFileLock(join(idempotencyDir(), ".lock"), "idempotency lock", fn);
}

function scopeOf(record: IdempotencyRecord): IdempotencyScope {
  return { key: record.key, wallet: record.wallet, chainId: record.chain_id };
}

function recordPath(scope: IdempotencyScope) {
  // Hashing makes any key a safe file name.
  const id = createHash("sha256")
    .update(JSON.stringify([scope.wallet.toLowerCase(), scope.chainId, scope.key]))
    .digest("hex");
  return join(idempotencyDir(), `${id}.json`);
}

function parseRecord(text: string) {
  try {
    const parsed = recordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
