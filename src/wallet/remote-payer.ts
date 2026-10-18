import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "incur";
import { getAddress, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { withFileLock } from "../payment/session-lock.js";
import { walletError } from "../shared/errors.js";
import { ensurePrivateWalletDirectory, writePrivateFile } from "./store.js";

/**
 * The remote payer (D2): one secp256k1 EOA per wallet that pays on EVM chains such as Base, where
 * neither the passkey wallet nor its Tempo access keys can sign. Funding delivers exactly a
 * payment's shortfall to it just before it signs, so it holds at most dust.
 *
 * Its key lives in `remote-payers.json` beside the wallet store, readable only by the owner. The
 * wallet store is rewritten whole by the CLI and the accounts SDK, which would drop a field they do
 * not know, and losing this key strands whatever it holds; nothing ever deletes this file. The key
 * is never printed, logged, or returned in output; only its address is.
 */

const entrySchema = z.object({
  address: z.string(),
  privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  createdAt: z.number(),
});

const fileSchema = z.object({
  version: z.literal(1),
  /** By lowercase wallet address. */
  payers: z.record(z.string(), entrySchema),
});

type RemotePayerFile = z.infer<typeof fileSchema>;

export function remotePayersPath() {
  return join(homedir(), ".tempo", "wallet", "remote-payers.json");
}

/** The remote payer of `wallet`: its address and a signer, or `undefined` when none exists yet. */
export async function loadRemotePayer(wallet: string) {
  const entry = (await readRemotePayers()).payers[wallet.toLowerCase()];
  return entry ? remotePayer(entry) : undefined;
}

/**
 * The remote payer of `wallet`, created on first use. Creation holds a file lock and rereads the
 * file under it, so concurrent processes all get the same key.
 */
export async function ensureRemotePayer(wallet: string) {
  const existing = await loadRemotePayer(wallet);
  if (existing) return existing;
  const path = remotePayersPath();
  await ensurePrivateWalletDirectory(path);
  return await withFileLock(`${path}.lock`, "remote payer lock", async () => {
    const file = await readRemotePayers();
    const key = wallet.toLowerCase();
    const current = file.payers[key];
    if (current) return remotePayer(current);
    const privateKey = generatePrivateKey();
    const entry = {
      address: privateKeyToAccount(privateKey).address,
      privateKey,
      createdAt: Math.floor(Date.now() / 1000),
    };
    await writePrivateFile(
      path,
      `${JSON.stringify({ ...file, payers: { ...file.payers, [key]: entry } }, null, 2)}\n`,
    );
    return remotePayer(entry);
  });
}

function remotePayer(entry: z.infer<typeof entrySchema>) {
  const account = privateKeyToAccount(entry.privateKey as `0x${string}`);
  // A file whose address does not match its key was edited; paying from it could fund nobody.
  if (account.address.toLowerCase() !== entry.address.toLowerCase())
    throw remotePayerFileError("names an address its key does not sign for");
  return { address: getAddress(account.address) as Address, account };
}

async function readRemotePayers(): Promise<RemotePayerFile> {
  let text: string;
  try {
    text = await readFile(remotePayersPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, payers: {} };
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw remotePayerFileError("is not valid JSON");
  }
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) throw remotePayerFileError("is not a remote payer file");
  return parsed.data;
}

/**
 * A remote payer file the CLI cannot use. It may hold keys with funds, so the CLI never rewrites
 * or removes it; the owner must repair it.
 */
function remotePayerFileError(problem: string) {
  return walletError({
    code: "E_USAGE",
    message: `${remotePayersPath()} ${problem}. It may hold the key of funds on other chains, so it was left unchanged; restore it from a backup.`,
  });
}
