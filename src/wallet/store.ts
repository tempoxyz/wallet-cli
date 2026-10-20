import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "incur";

import { withFileLock } from "../payment/session-lock.js";
import { getArray, getRecord } from "../shared/utils.js";

export type AccessKeyLimit = {
  token: string;
  limit: string;
  period?: number | undefined;
};

export type AccessKeyScope = {
  address: string;
  selector?: string | undefined;
  recipients?: readonly string[] | undefined;
};

export type WalletState = {
  /** `keyType` is the SDK's signer type for an account it stored with a local key. */
  accounts: readonly { address: string; keyType?: string | undefined }[];
  accessKeys: readonly {
    address: string;
    access: string;
    chainId: number;
    expiry?: number | undefined;
    handle?: unknown | undefined;
    keyPair?: unknown | undefined;
    keyAuthorization?: unknown | undefined;
    keyType?: string | undefined;
    privateKey?: string | undefined;
    publicKey?: string | undefined;
    limits?: readonly AccessKeyLimit[] | undefined;
    permissionSemantics?: 1 | undefined;
    scopes?: readonly AccessKeyScope[] | undefined;
  }[];
  activeAccount?: number | undefined;
  chainId?: number | undefined;
};

const privateDirMode = 0o700;
const privateFileMode = 0o600;

export async function loadWalletState(): Promise<WalletState> {
  const path = walletStorePath();
  let text: string;

  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return await migrateLegacyWalletState();
    throw error;
  }

  const value = JSON.parse(text) as unknown;
  const envelope = getRecord(value)["tempo-cli.store"];
  const state = getRecord(envelope).state;
  if (!state) return emptyWalletState();

  const record = getRecord(state);
  const accounts = getArray(record.accounts).flatMap((account) => {
    const item = getRecord(account);
    if (typeof item.address !== "string") return [];
    return [
      {
        address: item.address,
        ...(typeof item.keyType === "string" ? { keyType: item.keyType } : {}),
      },
    ];
  });
  const accessKeys = getArray(record.accessKeys).flatMap((key) => {
    const item = getRecord(key);
    if (
      typeof item.address !== "string" ||
      typeof item.access !== "string" ||
      typeof item.chainId !== "number"
    )
      return [];
    const limits = parseAccessKeyLimits(item.limits);
    const scopes = parseAccessKeyScopes(item.scopes);

    return [
      {
        address: item.address,
        access: item.access,
        chainId: item.chainId,
        expiry: typeof item.expiry === "number" ? item.expiry : undefined,
        ...(isRecord(item.handle) ? { handle: reviveBigInts(item.handle) } : {}),
        ...(isRecord(item.keyPair) ? { keyPair: reviveBigInts(item.keyPair) } : {}),
        keyAuthorization: reviveBigInts(item.keyAuthorization),
        keyType: typeof item.keyType === "string" ? item.keyType : undefined,
        privateKey: typeof item.privateKey === "string" ? item.privateKey : undefined,
        publicKey: typeof item.publicKey === "string" ? item.publicKey : undefined,
        // Dropped entries would misreport the permission set, so report it as unknown instead.
        permissionSemantics:
          item.permissionSemantics === 1 && limits.valid && scopes.valid ? (1 as const) : undefined,
        limits: limits.value,
        scopes: scopes.value,
      },
    ];
  });

  return {
    accounts,
    accessKeys,
    activeAccount: typeof record.activeAccount === "number" ? record.activeAccount : undefined,
    chainId: typeof record.chainId === "number" ? record.chainId : undefined,
  };
}

function reviveBigInts(value: unknown): unknown {
  if (typeof value === "string" && value.endsWith("#__bigint")) {
    return BigInt(value.slice(0, -"#__bigint".length));
  }
  if (Array.isArray(value)) return value.map(reviveBigInts);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, reviveBigInts(item)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseAccessKeyLimits(value: unknown) {
  if (!Array.isArray(value)) return { value: undefined, valid: value === undefined };
  const limits = value.flatMap((limit): AccessKeyLimit[] => {
    const item = getRecord(limit);
    if (
      typeof item.token !== "string" ||
      typeof item.limit !== "string" ||
      (item.period !== undefined && typeof item.period !== "number")
    )
      return [];
    return [
      {
        token: item.token,
        limit: item.limit,
        period: typeof item.period === "number" ? item.period : undefined,
      },
    ];
  });
  return { value: limits, valid: limits.length === value.length };
}

function parseAccessKeyScopes(value: unknown) {
  if (!Array.isArray(value)) return { value: undefined, valid: value === undefined };
  const scopes = value.flatMap((scope): AccessKeyScope[] => {
    const item = getRecord(scope);
    if (
      typeof item.address !== "string" ||
      (item.selector !== undefined && typeof item.selector !== "string") ||
      (item.recipients !== undefined &&
        (!Array.isArray(item.recipients) ||
          !item.recipients.every((recipient: unknown) => typeof recipient === "string")))
    )
      return [];
    return [
      {
        address: item.address,
        selector: typeof item.selector === "string" ? item.selector : undefined,
        recipients: item.recipients as string[] | undefined,
      },
    ];
  });
  return { value: scopes, valid: scopes.length === value.length };
}

/**
 * Saves `state` as the store's `tempo-cli.store` item. Every other item in the file, such as the
 * remote payers (`tempo-cli.remotePayers`), is kept as it is: the file is shared, and the accounts
 * SDK likewise rewrites only the item it sets.
 */
export async function saveWalletState(state: WalletState) {
  const path = walletStorePath();
  await ensurePrivateWalletDirectory(path);
  await writePrivateFile(
    path,
    JSON.stringify(
      {
        ...(await otherStoreItems(path)),
        "tempo-cli.store": {
          state: {
            // Account key material is never loaded, so a key type would describe a key not saved.
            accounts: state.accounts.map(({ address }) => ({ address })),
            accessKeys: state.accessKeys,
            activeAccount: state.activeAccount ?? 0,
            chainId: state.chainId ?? 4217,
          },
          version: 0,
        },
      },
      (_key, value: unknown) => (typeof value === "bigint" ? `${value}#__bigint` : value),
      2,
    ),
  );
}

/** The store file's items other than `tempo-cli.store`, kept verbatim; none when unreadable. */
async function otherStoreItems(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // An unparseable store has no items left to keep; the SDK's own read reports it.
    return {};
  }
  if (!isRecord(value)) return {};
  const { "tempo-cli.store": _store, ...others } = value;
  return others;
}

/**
 * Saves `update` applied to the wallet store as it is now, read just before the write, so a change
 * another process made since the command first read the store, such as a login, survives. Settle
 * the SDK's own queued writes first (`settleWalletStore`).
 */
export async function updateWalletState(update: (current: WalletState) => WalletState) {
  await saveWalletState(update(await loadWalletState()));
}

export function walletStorePath() {
  return join(homedir(), ".tempo", "wallet", "store.json");
}

const pendingLoginSchema = z.object({
  network: z.enum(["mainnet", "testnet"]),
  /** The wallet's device-code `/register` response. */
  registration: z.object({
    device_code: z.string(),
    user_code: z.string(),
    verification_uri: z.string(),
    verification_uri_complete: z.string().optional(),
    interval: z.number().optional(),
  }),
  /** PKCE verifier that `/token` polls for the device code must present. */
  codeVerifier: z.string(),
  /** Keystore handle and public key of the access key the wallet is asked to authorize. */
  accessKey: z.object({
    handle: z.looseObject({ kind: z.string() }),
    publicKey: z.templateLiteral(["0x", z.string()]),
  }),
  /** Unix time in seconds when the device code expires. */
  expiresAt: z.number(),
});

/** A device-code login that `tempo wallet login` started and `login status` can finish. */
export type PendingLogin = z.infer<typeof pendingLoginSchema>;

/** Validates a pending login, keeping only the fields `login status` uses. */
export function parsePendingLogin(value: unknown): PendingLogin {
  return pendingLoginSchema.parse(value);
}

export function pendingLoginPath() {
  return join(homedir(), ".tempo", "wallet", "pending-login.json");
}

/** The pending login, or `undefined` when there is none or the file is not a valid one. */
export async function loadPendingLogin(): Promise<PendingLogin | undefined> {
  let text: string;
  try {
    text = await readFile(pendingLoginPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return parsePendingLogin(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** Replaces any pending login. The file holds the access key, so only the owner can read it. */
export async function savePendingLogin(pending: PendingLogin) {
  const path = pendingLoginPath();
  await ensurePrivateWalletDirectory(path);
  await withPendingLoginLock(() => writePrivateFile(path, JSON.stringify(pending, null, 2)));
}

/**
 * Removes the pending login. With `deviceCode`, removes it only while it is still that login,
 * so a process finishing an older login leaves a newer one in place: the check and the removal
 * hold the lock `savePendingLogin` writes under, so no login is saved between them. A lock that
 * cannot be taken fails the clear, unless `bestEffort` leaves the file instead, for a caller
 * that has already stored its result.
 */
export async function clearPendingLogin(
  deviceCode?: string | undefined,
  { bestEffort = false }: { bestEffort?: boolean | undefined } = {},
) {
  if (deviceCode === undefined) return await removePendingLogin();
  const isThisLogin = async () =>
    (await loadPendingLogin())?.registration.device_code === deviceCode;
  // A login that is no longer saved needs no lock; one that is gets checked again under it.
  if (!(await isThisLogin())) return;
  let locked = false;
  await withPendingLoginLock(async () => {
    locked = true;
    if (await isThisLogin()) await removePendingLogin();
  }).catch((error: unknown) => {
    if (locked || !bestEffort) throw error;
  });
}

async function removePendingLogin() {
  await unlink(pendingLoginPath()).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function withPendingLoginLock<T>(fn: () => Promise<T>) {
  const path = join(homedir(), ".tempo", "wallet", "pending-login.lock");
  return withFileLock(path, "pending login lock", fn);
}

const rawAmount = z.string().regex(/^\d+$/);

const pendingFundSchema = z.object({
  network: z.enum(["mainnet", "testnet"]),
  action: z.enum(["fund", "mach", "crypto", "claim"]),
  /** The wallet the funding URL credits. */
  wallet: z.templateLiteral(["0x", z.string()]),
  /**
   * Whether `wallet` was the logged-in wallet rather than an `--address`; such a funding ends
   * once that wallet is no longer the logged-in one.
   */
  activeWallet: z.boolean(),
  url: z.string(),
  /** The `--amount` the URL prefills, if any. */
  amount: z.string().nullable(),
  /**
   * Each token the funding flow can deliver, with its raw balance when funding started and the
   * raw increase that counts as the funding arriving.
   */
  assets: z
    .array(
      z.object({
        token: z.templateLiteral(["0x", z.string()]),
        symbol: z.string(),
        baseline: rawAmount,
        minimum: rawAmount,
      }),
    )
    .min(1),
  /** Unix time in seconds after which `fund status` stops waiting. */
  expiresAt: z.number(),
});

/** A funding that `tempo wallet fund` started and `fund status` can keep waiting on. */
export type PendingFund = z.infer<typeof pendingFundSchema>;

export function parsePendingFund(value: unknown): PendingFund {
  return pendingFundSchema.parse(value);
}

export function pendingFundPath() {
  return join(homedir(), ".tempo", "wallet", "pending-fund.json");
}

/** The pending funding, or `undefined` when there is none or the file is not a valid one. */
export async function loadPendingFund(): Promise<PendingFund | undefined> {
  let text: string;
  try {
    text = await readFile(pendingFundPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return parsePendingFund(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** Replaces any pending funding. The file names the wallet, so only the owner can read it. */
export async function savePendingFund(pending: PendingFund) {
  const path = pendingFundPath();
  await ensurePrivateWalletDirectory(path);
  await writePrivateFile(path, JSON.stringify(pending, null, 2));
}

/**
 * Removes the pending funding. With `pending`, removes it only while it is still that funding,
 * so a process finishing an older funding leaves a newer one in place.
 */
export async function clearPendingFund(pending?: PendingFund | undefined) {
  if (pending !== undefined && !isDeepStrictEqual(await loadPendingFund(), pending)) return;
  await unlink(pendingFundPath()).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export function emptyWalletState(): WalletState {
  return {
    accounts: [],
    accessKeys: [],
  };
}

async function migrateLegacyWalletState() {
  const state = await loadLegacyWalletState();
  if (state.accounts.length || state.accessKeys.length) await saveWalletState(state);
  return state;
}

async function loadLegacyWalletState(): Promise<WalletState> {
  let text: string;
  try {
    text = await readFile(legacyKeysPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyWalletState();
    throw error;
  }

  const keys = parseLegacyKeys(text);
  const accounts = [...new Set(keys.map((key) => key.access))].map((address) => ({ address }));
  return {
    accounts,
    accessKeys: keys,
    ...(accounts.length ? { activeAccount: 0 } : {}),
    ...(keys[0] ? { chainId: keys[0].chainId } : {}),
  };
}

function legacyKeysPath() {
  return join(homedir(), ".tempo", "wallet", "keys.toml");
}

function parseLegacyKeys(text: string): WalletState["accessKeys"] {
  const keys: LegacyKey[] = [];
  let key: LegacyKey | undefined;
  let limit: LegacyLimit | undefined;
  let section: "key" | "limit" | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    if (line === "[[keys]]") {
      key = {};
      keys.push(key);
      limit = undefined;
      section = "key";
      continue;
    }

    if (line === "[[keys.limits]]") {
      if (!key) continue;
      limit = {};
      key.limits = [...(key.limits ?? []), limit];
      section = "limit";
      continue;
    }

    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;

    const [, field, raw] = match;
    const value = parseTomlValue(raw ?? "");
    if (section === "limit" && limit) {
      if (field === "currency" && typeof value === "string") limit.token = value;
      if (field === "limit" && typeof value === "string") limit.limit = value;
      continue;
    }

    if (section !== "key" || !key) continue;
    if (field === "wallet_address" && typeof value === "string") key.access = value;
    if (field === "chain_id" && typeof value === "number") key.chainId = value;
    if (field === "key_address" && typeof value === "string") key.address = value;
    if (field === "key" && typeof value === "string") key.privateKey = value;
    if (field === "key_authorization" && typeof value === "string") key.keyAuthorization = value;
    if (field === "key_type" && typeof value === "string") key.keyType = value;
    if (field === "expiry" && typeof value === "number") key.expiry = value;
  }

  return keys.flatMap((key) => {
    if (
      typeof key.access !== "string" ||
      typeof key.address !== "string" ||
      typeof key.chainId !== "number"
    )
      return [];

    return [
      {
        access: key.access,
        address: key.address,
        chainId: key.chainId,
        expiry: key.expiry,
        keyAuthorization: key.keyAuthorization,
        keyType: key.keyType ?? "secp256k1",
        privateKey: key.privateKey,
        limits: (key.limits ?? []).flatMap((limit) => {
          if (typeof limit.token !== "string" || typeof limit.limit !== "string") return [];
          return [{ token: limit.token, limit: `${limit.limit}#__bigint` }];
        }),
      },
    ];
  });
}

function stripTomlComment(line: string) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (char === "#" && !quoted) return line.slice(0, index);
  }
  return line;
}

function parseTomlValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"'))
    return trimmed.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed;
}

/** Creates the directory holding `path` and its parent, `~/.tempo`, accessible only by the owner. */
export async function ensurePrivateWalletDirectory(path: string) {
  const walletDir = dirname(path);
  const tempoDir = dirname(walletDir);
  await mkdir(tempoDir, { recursive: true, mode: privateDirMode });
  await chmodIfSupported(tempoDir, privateDirMode);
  await mkdir(walletDir, { recursive: true, mode: privateDirMode });
  await chmodIfSupported(walletDir, privateDirMode);
}

/**
 * Replaces `path` with `contents` through a renamed temporary file, readable only by the owner. The
 * mode is set before the rename, which keeps it: the file at `path` afterwards may already be
 * another process's, or gone.
 */
export async function writePrivateFile(path: string, contents: string) {
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, contents, { mode: privateFileMode });
    await chmodIfSupported(tempPath, privateFileMode);
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function chmodIfSupported(path: string, mode: number) {
  try {
    await chmod(path, mode);
  } catch (error) {
    if (process.platform === "win32") return;
    throw error;
  }
}

type LegacyKey = {
  access?: string | undefined;
  address?: string | undefined;
  chainId?: number | undefined;
  expiry?: number | undefined;
  keyAuthorization?: string | undefined;
  keyType?: string | undefined;
  privateKey?: string | undefined;
  limits?: LegacyLimit[] | undefined;
};

type LegacyLimit = {
  token?: string | undefined;
  limit?: string | undefined;
};
