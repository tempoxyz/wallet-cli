import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "incur";

import { walletError } from "../shared/errors.js";
import { ensurePrivateWalletDirectory, writePrivateFile } from "../wallet/store.js";
import { withFileLock } from "./session-lock.js";

/**
 * Funding attempts (Phase 4). `tempo request` is a one-shot process, so before any funds move it
 * saves the attempt ID machine-fetch keys cross-chain funding on, with the request it pays for.
 * Rerunning the same request for the same payment reuses the ID, so funding a crash interrupted is
 * reconciled instead of repeated. Records hold plaintext metadata only, never keys or credentials.
 */

const recordSchema = z.object({
  attemptId: z.string().min(1),
  /** Digest of the request's method, URL, and body. */
  fingerprint: z.string(),
  /** machine-fetch's identity of the payment terms (see `requirementKey`). */
  requirementKey: z.string(),
  /** Tempo chain the funding spends on. */
  tempoChainId: z.number(),
  destination: z.object({ chainId: z.number(), name: z.string() }),
  /** The account the destination funds are delivered to and the payment is signed by. */
  payer: z.string(),
  /** The Tempo account the funding spends from. */
  source: z.string(),
  url: z.string(),
  createdAt: z.number(),
});

export type AttemptRecord = z.infer<typeof recordSchema>;

/** Where funding state lives: attempt records and machine-fetch's operation store. */
export function fundingDirectory() {
  return join(homedir(), ".tempo", "wallet", "funding");
}

export function operationsDirectory() {
  return join(fundingDirectory(), "operations");
}

function attemptsDirectory() {
  return join(fundingDirectory(), "attempts");
}

function attemptPath(attemptId: string) {
  return join(attemptsDirectory(), `${createHash("sha256").update(attemptId).digest("hex")}.json`);
}

/** Digest identifying a request: its method, URL, and body. */
export function requestFingerprint(request: { method: string; url: string; body: string }) {
  return createHash("sha256")
    .update(JSON.stringify([request.method.toUpperCase(), request.url, request.body]))
    .digest("hex");
}

/**
 * The attempt for a request and payment: the saved one with the same fingerprint and terms, else a
 * new one, saved before this returns. Both happen under one lock, so concurrent runs of the same
 * request share an attempt.
 */
export async function claimAttempt(
  terms: Omit<AttemptRecord, "attemptId" | "createdAt">,
): Promise<AttemptRecord & { reused: boolean }> {
  const directory = attemptsDirectory();
  await ensurePrivateWalletDirectory(join(fundingDirectory(), "x"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return await withFileLock(join(directory, ".lock"), "funding attempt lock", async () => {
    const existing = (await listAttempts()).find(
      (record) =>
        record.fingerprint === terms.fingerprint &&
        record.requirementKey === terms.requirementKey &&
        record.payer.toLowerCase() === terms.payer.toLowerCase() &&
        record.source.toLowerCase() === terms.source.toLowerCase(),
    );
    if (existing) return { ...existing, reused: true };
    const record: AttemptRecord = {
      ...terms,
      attemptId: randomUUID(),
      createdAt: Math.floor(Date.now() / 1000),
    };
    await writePrivateFile(attemptPath(record.attemptId), `${JSON.stringify(record, null, 2)}\n`);
    return { ...record, reused: false };
  });
}

/** Every saved attempt, oldest first. */
export async function listAttempts(): Promise<AttemptRecord[]> {
  let names: string[];
  try {
    names = await readdir(attemptsDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: AttemptRecord[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    const record = await readAttemptFile(join(attemptsDirectory(), name));
    if (record) records.push(record);
  }
  return records.sort((left, right) => left.createdAt - right.createdAt);
}

/** The saved attempt `attemptId`, if any. */
export async function loadAttempt(attemptId: string) {
  return await readAttemptFile(attemptPath(attemptId));
}

/** Forgets an attempt whose funding is settled: paid with, refunded, or never started. */
export async function removeAttempt(attemptId: string) {
  await unlink(attemptPath(attemptId)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function readAttemptFile(path: string) {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return recordSchema.parse(JSON.parse(text));
  } catch {
    throw walletError({
      code: "E_RUNTIME",
      message: `Funding attempt ${path} is not readable; it may name funds in flight, so it was left unchanged.`,
    });
  }
}
