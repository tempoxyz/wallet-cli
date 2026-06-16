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
  const path = join(homedir(), ".tempo", "wallet", "store.json");
  let text: string;

  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyWalletState();
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
      null,
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
