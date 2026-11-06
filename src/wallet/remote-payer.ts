import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { Keystore } from "accounts";
import { Storage } from "accounts/cli";
import { z } from "incur";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { withFileLock } from "../payment/session-lock.js";
import { walletError } from "../shared/errors.js";
import { ensurePrivateWalletDirectory, walletStorePath, writePrivateFile } from "./store.js";

/**
 * The remote payer (D2): one secp256k1 EOA per wallet that pays on EVM chains such as Base, where
 * neither the passkey wallet nor its Tempo access keys can sign. Funding delivers exactly a
 * payment's shortfall to it just before it signs, so it holds at most dust.
 *
 * Its key is created by the same accounts-SDK keystore as the wallet's secp256k1 access keys, and
 * its handle is kept the same way: in the wallet store (`store.json`), as the `tempo-cli.remotePayers`
 * item next to the SDK's `tempo-cli.store`, written through the SDK's filesystem storage, which
 * rewrites only the item it sets. The store has several writers in separate processes and no
 * shared lock, and losing this key strands whatever it holds, so `remote-payers.json` keeps a
 * write-once backup of every payer: it is written when a payer is created, never rewritten or
 * removed, and a load restores any payer the store lost. The key is never printed, logged, or
 * returned in output; only its address is.
 */

const handleSchema = z.object({
  kind: z.literal("secp256k1"),
  privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

const entrySchema = z.object({
  address: z.string(),
  keyType: z.literal("secp256k1"),
  handle: handleSchema,
  createdAt: z.number(),
});

type Entry = z.infer<typeof entrySchema>;

const itemSchema = z.object({
  version: z.literal(1),
  /** By lowercase wallet address. */
  payers: z.record(z.string(), entrySchema),
});

/** The backup file's original shape, from before payers moved into the wallet store. */
const backupEntrySchema = z.object({
  address: z.string(),
  privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  createdAt: z.number(),
});

const backupSchema = z.object({
  version: z.literal(1),
  payers: z.record(z.string(), backupEntrySchema),
});

type Payers = Record<string, Entry>;

/** The write-once backup of every remote payer the wallet store holds. */
export function remotePayersPath() {
  return join(homedir(), ".tempo", "wallet", "remote-payers.json");
}

const itemName = "remotePayers";

/** The SDK's storage over the wallet store, so payer writes queue behind the SDK's own. */
function walletStorage() {
  return Storage.filesystem({ path: walletStorePath() });
}

/** The remote payer of `wallet`: its address and a signer, or `undefined` when none exists yet. */
export async function loadRemotePayer(wallet: string) {
  const entry = (await payers()).current[wallet.toLowerCase()];
  return entry ? remotePayer(entry) : undefined;
}

/**
 * The remote payer of `wallet`, created on first use through the wallet's secp256k1 keystore.
 * Creation holds a file lock and rereads both copies under it, so concurrent processes all get the
 * same key; the backup is written before the store, so a payer exists nowhere without one.
 */
export async function ensureRemotePayer(wallet: string) {
  const existing = await loadRemotePayer(wallet);
  if (existing) return existing;
  const path = remotePayersPath();
  await ensurePrivateWalletDirectory(path);
  return await withFileLock(`${path}.lock`, "remote payer lock", async () => {
    const key = wallet.toLowerCase();
    const { current, backup } = await payers();
    const found = current[key];
    if (found) return remotePayer(found);
    const { handle } = await Keystore.secp256k1().createKey();
    const parsed = handleSchema.parse(handle);
    const entry: Entry = {
      address: privateKeyToAccount(parsed.privateKey as Hex).address,
      keyType: "secp256k1",
      handle: parsed,
      createdAt: Math.floor(Date.now() / 1000),
    };
    await writeBackup({ ...backup, [key]: entry });
    await writeItem({ ...current, [key]: entry });
    return remotePayer(entry);
  });
}

/**
 * Every remote payer, from the wallet store, with any payer only the backup holds restored into
 * the store: one created before payers moved there, or one a concurrent store rewrite dropped.
 */
async function payers(): Promise<{ current: Payers; backup: Payers }> {
  const [stored, backup] = await Promise.all([readItem(), readBackup()]);
  const missing = Object.entries(backup).filter(([key]) => !stored[key]);
  if (missing.length === 0) return { current: stored, backup };
  const current = { ...stored, ...Object.fromEntries(missing) };
  await withFileLock(`${remotePayersPath()}.lock`, "remote payer lock", async () => {
    const latest = await readItem();
    await writeItem({ ...Object.fromEntries(missing), ...latest });
  });
  return { current, backup };
}

function remotePayer(entry: Entry) {
  const account = privateKeyToAccount(entry.handle.privateKey as Hex);
  // An entry whose address does not match its key was edited; paying from it could fund nobody.
  if (account.address.toLowerCase() !== entry.address.toLowerCase())
    throw remotePayerError(
      walletStorePath(),
      "names a remote payer address its key does not sign for",
    );
  return { address: getAddress(account.address) as Address, account };
}

async function readItem(): Promise<Payers> {
  let value: unknown;
  try {
    value = await walletStorage().getItem(itemName);
  } catch {
    throw remotePayerError(walletStorePath(), "cannot be read");
  }
  if (value === null || value === undefined) return {};
  const parsed = itemSchema.safeParse(value);
  if (!parsed.success)
    throw remotePayerError(walletStorePath(), "holds a malformed remote payer entry");
  return parsed.data.payers;
}

async function writeItem(payers: Payers) {
  await walletStorage().setItem(itemName, { version: 1, payers });
  // Read back: the payer is only usable once the store holds exactly what was written.
  const written = await readItem();
  for (const [key, entry] of Object.entries(payers))
    if (written[key]?.address.toLowerCase() !== entry.address.toLowerCase())
      throw remotePayerError(walletStorePath(), "did not keep a remote payer it was given");
}

async function readBackup(): Promise<Payers> {
  let text: string;
  try {
    text = await readFile(remotePayersPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw remotePayerError(remotePayersPath(), "is not valid JSON");
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) throw remotePayerError(remotePayersPath(), "is not a remote payer backup");
  return Object.fromEntries(
    Object.entries(parsed.data.payers).map(([key, entry]) => [
      key,
      {
        address: entry.address,
        keyType: "secp256k1" as const,
        handle: { kind: "secp256k1" as const, privateKey: entry.privateKey },
        createdAt: entry.createdAt,
      },
    ]),
  );
}

/** Adds payers to the backup; an existing entry is never changed or removed. */
async function writeBackup(payers: Payers) {
  const current = await readBackup();
  const merged = { ...payers, ...current };
  await writePrivateFile(
    remotePayersPath(),
    `${JSON.stringify(
      {
        version: 1,
        payers: Object.fromEntries(
          Object.entries(merged).map(([key, entry]) => [
            key,
            {
              address: entry.address,
              privateKey: entry.handle.privateKey,
              createdAt: entry.createdAt,
            },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * A remote payer store the CLI cannot use. It may hold keys with funds, so the CLI never rewrites
 * or removes it; the owner must repair it.
 */
function remotePayerError(path: string, problem: string) {
  return walletError({
    code: "E_USAGE",
    message: `${path} ${problem}. It may hold the key of funds on other chains, so it was left unchanged; restore it from a backup.`,
  });
}
