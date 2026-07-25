import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { Store } from "accounts";
import { Storage } from "accounts/cli";

import { createProvider } from "../provider.js";

export type AccessKeyScope = {
  address: string;
  selector?: string | undefined;
  recipients?: readonly string[] | undefined;
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
    limits?: readonly {
      token: string;
      limit: bigint | string;
      period?: number | undefined;
    }[];
    scopes?: readonly AccessKeyScope[] | undefined;
  }[];
  activeAccount?: number | undefined;
  chainId?: number | undefined;
};

/**
 * Loads the wallet state through the Accounts SDK provider store.
 *
 * The Accounts SDK owns the current `store.json` path, envelope, validation,
 * hydration, serialization, and filesystem safety. Wallet CLI only retains the
 * one-time migration from its legacy `keys.toml` format.
 */
export async function loadWalletState(): Promise<WalletState> {
  const persisted = await Storage.filesystem().getItem("store");
  const store = await loadWalletStore();
  const state = store.getState();
  if (persisted !== null || state.accounts.length || state.accessKeys.length)
    return state as unknown as WalletState;

  const legacy = await loadLegacyWalletState();
  if (!legacy.accounts.length && !legacy.accessKeys.length) return state as unknown as WalletState;
  await replaceWalletState(store, legacy);
  return store.getState() as unknown as WalletState;
}

/** Replaces the Accounts SDK provider state and waits for filesystem persistence. */
export async function saveWalletState(state: WalletState) {
  const store = await loadWalletStore();
  await replaceWalletState(store, state);
}

/** Returns the Accounts SDK's default CLI storage path. */
export function walletStorePath() {
  return Storage.defaultPath();
}

export function emptyWalletState(): WalletState {
  return {
    accounts: [],
    accessKeys: [],
    activeAccount: 0,
    chainId: 4217,
  };
}

type WalletStore = {
  getState(): Store.State;
  setState(state: Store.State): void;
};

async function loadWalletStore(): Promise<WalletStore> {
  const provider = createProvider() as unknown as { store: WalletStore };
  await Store.waitForHydration(provider.store as never);
  return provider.store;
}

async function replaceWalletState(store: WalletStore, state: WalletState) {
  const current = store.getState();
  store.setState({
    ...current,
    accounts: state.accounts as Store.State["accounts"],
    accessKeys: state.accessKeys as Store.State["accessKeys"],
    activeAccount: state.activeAccount ?? 0,
    chainId: state.chainId ?? 4217,
  });

  // Filesystem storage serializes operations per path. Queueing a read after
  // Zustand's write gives CLI commands an explicit persistence barrier.
  await Storage.filesystem().getItem("store");
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
    accessKeys: keys as unknown as WalletState["accessKeys"],
    ...(accounts.length ? { activeAccount: 0 } : {}),
    ...(keys[0] ? { chainId: keys[0].chainId } : {}),
  };
}

function legacyKeysPath() {
  return join(homedir(), ".tempo", "wallet", "keys.toml");
}

function parseLegacyKeys(text: string): Store.State["accessKeys"] {
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
    if (field === "key_type" && (value === "p256" || value === "secp256k1")) key.keyType = value;
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
        limits: (key.limits ?? []).flatMap((item) => {
          if (typeof item.token !== "string" || typeof item.limit !== "string") return [];
          return [{ token: item.token, limit: BigInt(item.limit) }];
        }),
      },
    ] as Store.State["accessKeys"];
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
  keyType?: "p256" | "secp256k1" | undefined;
  privateKey?: string | undefined;
  limits?: LegacyLimit[] | undefined;
};

type LegacyLimit = {
  token?: string | undefined;
  limit?: string | undefined;
};
