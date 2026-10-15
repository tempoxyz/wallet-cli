import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "incur";

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
 * create lets only one of several concurrent sends with the same key claim it.
 */
export async function createIdempotencyRecord(record: IdempotencyRecord) {
  await mkdir(idempotencyDir(), { recursive: true, mode: 0o700 });
  try {
    await writeFile(recordPath(scopeOf(record)), JSON.stringify(record, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
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
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const cutoff = now - idempotencyRecordTtlSeconds;
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
