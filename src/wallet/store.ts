import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getArray, getRecord } from "../shared/utils.js";

export type WalletState = {
  accounts: readonly { address: string }[];
  accessKeys: readonly {
    address: string;
    access: string;
    chainId: number;
    expiry?: number | undefined;
    keyAuthorization?: unknown | undefined;
    keyType?: string | undefined;
    privateKey?: string | undefined;
    limits: readonly { token: string; limit: string }[];
  }[];
  activeAccount?: number | undefined;
  chainId?: number | undefined;
};

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
        keyAuthorization: reviveBigInts(item.keyAuthorization),
        keyType: typeof item.keyType === "string" ? item.keyType : undefined,
        privateKey: typeof item.privateKey === "string" ? item.privateKey : undefined,
        limits: getArray(item.limits).flatMap((limit) => {
          const value = getRecord(limit);
          if (typeof value.token !== "string" || typeof value.limit !== "string") return [];
          return [{ token: value.token, limit: value.limit }];
        }),
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

export async function saveWalletState(state: WalletState) {
  const path = walletStorePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
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
