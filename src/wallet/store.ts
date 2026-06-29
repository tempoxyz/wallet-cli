import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getArray, getRecord } from "../shared/utils.js";

export type AccessKeyLimit = {
  token: string;
  limit: string;
  period?: number | undefined;
};

export type AccessKeyScope = {
  address: string;
  selector?: string | undefined;
  recipients: readonly string[];
};

export type WalletState = {
  accounts: readonly { address: string }[];
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
    limits: readonly AccessKeyLimit[];
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
    return typeof item.address === "string" ? [{ address: item.address }] : [];
  });
  const accessKeys = getArray(record.accessKeys).flatMap((key) => {
    const item = getRecord(key);
    if (
      typeof item.address !== "string" ||
      typeof item.access !== "string" ||
      typeof item.chainId !== "number"
    )
      return [];

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
        limits: parseAccessKeyLimits(item.limits),
        scopes: parseAccessKeyScopes(item.scopes),
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

function parseAccessKeyLimits(value: unknown): AccessKeyLimit[] {
  return getArray(value).flatMap((limit) => {
    const item = getRecord(limit);
    if (typeof item.token !== "string" || typeof item.limit !== "string") return [];
    if (item.period !== undefined && typeof item.period !== "number") return [];
    return [
      {
        token: item.token,
        limit: item.limit,
        period: typeof item.period === "number" ? item.period : undefined,
      },
    ];
  });
}

function parseAccessKeyScopes(value: unknown): AccessKeyScope[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const scopes = getArray(value).flatMap((scope) => {
    const item = getRecord(scope);
    if (typeof item.address !== "string") return [];
    return [
      {
        address: item.address,
        selector: typeof item.selector === "string" ? item.selector : undefined,
        recipients: getArray(item.recipients).flatMap((recipient) =>
          typeof recipient === "string" ? [recipient] : [],
        ),
      },
    ];
  });
  return scopes;
}

export async function saveWalletState(state: WalletState) {
  const path = walletStorePath();
  await ensurePrivateWalletDirectory(path);
  await writePrivateFile(
    path,
    JSON.stringify(
      {
        "tempo-cli.store": {
          state: {
            accounts: state.accounts,
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

export function walletStorePath() {
  return join(homedir(), ".tempo", "wallet", "store.json");
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

async function ensurePrivateWalletDirectory(path: string) {
  const walletDir = dirname(path);
  const tempoDir = dirname(walletDir);
  await mkdir(tempoDir, { recursive: true, mode: privateDirMode });
  await chmodIfSupported(tempoDir, privateDirMode);
  await mkdir(walletDir, { recursive: true, mode: privateDirMode });
  await chmodIfSupported(walletDir, privateDirMode);
}

async function writePrivateFile(path: string, contents: string) {
  const tempPath = join(
    dirname(path),
    `.store.json.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, contents, { mode: privateFileMode });
    await chmodIfSupported(tempPath, privateFileMode);
    await rename(tempPath, path);
    await chmodIfSupported(path, privateFileMode);
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
