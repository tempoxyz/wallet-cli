import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  emptyWalletState,
  loadWalletState,
  saveWalletState,
  walletStorePath,
} from "../src/wallet/store.js";

import {
  readWalletStoreJson,
  testAccessKey,
  testAccessKey2,
  testPrivateKey,
  testPrivateKey2,
  testWallet,
  testWallet2,
  useTempHome,
  usdc,
  walletState,
  walletStoreExists,
  writeLegacyKeysToml,
} from "./helpers.js";

describe("wallet store file", () => {
  it("resolves under the active HOME", async () => {
    const home = await useTempHome();

    expect(walletStorePath()).toBe(join(home, ".tempo", "wallet", "store.json"));
  });

  it("persists through the Accounts SDK filesystem storage", async () => {
    const home = await useTempHome();
    await saveWalletState({
      accounts: [{ address: testWallet }],
      accessKeys: [],
    });

    expect(await readFile(join(home, ".tempo", "wallet", "store.json"), "utf8")).toMatch(
      /"tempo-cli.store"/,
    );
    expect(await readWalletStoreJson()).toEqual({
      "tempo-cli.store": {
        state: {
          accounts: [{ address: testWallet }],
          accessKeys: [],
          activeAccount: 0,
          chainId: 4217,
        },
        version: 0,
      },
    });
  });

  it("stores wallet state under private directory and file permissions", async () => {
    const home = await useTempHome();
    await saveWalletState(walletState());

    await expectMode(join(home, ".tempo", "wallet"), 0o700);
    await expectMode(join(home, ".tempo", "wallet", "store.json"), 0o600);
  });

  it("tightens permissions for existing wallet store paths", async () => {
    const home = await useTempHome();
    const tempoDir = join(home, ".tempo");
    const walletDir = join(tempoDir, "wallet");
    const storePath = join(walletDir, "store.json");
    await chmod(tempoDir, 0o755);
    await chmod(walletDir, 0o755);
    await writeFile(storePath, "{}");
    await chmod(storePath, 0o644);

    await saveWalletState(walletState());

    await expectMode(walletDir, 0o700);
    await expectMode(storePath, 0o600);
  });

  it("loads the Accounts SDK default state when storage is missing", async () => {
    await useTempHome();

    expect(await loadWalletState()).toEqual(emptyWalletState());
  });

  it("round trips nested key authorization bigint values", async () => {
    await useTempHome();
    const keyAuthorization = {
      chainId: 4217n,
      limits: [{ limit: 100000000n, token: usdc }],
      signature: { bytes: "0x1234", nonce: 7n },
    };
    await saveWalletState(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            keyAuthorization,
          },
        ],
      }),
    );

    expect(await loadWalletState()).toEqual(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            keyAuthorization,
          },
        ],
      }),
    );
  });

  it("round trips accounts SDK managed access key material", async () => {
    await useTempHome();
    const managedKey = {
      ...walletState().accessKeys[0]!,
      handle: { jwk: { crv: "P-256", kty: "EC" }, kind: "webcrypto-p256" },
      keyType: "p256",
      publicKey: "0x04abcd",
    };

    await saveWalletState(walletState({ accessKeys: [managedKey] }));

    expect(await loadWalletState()).toEqual(walletState({ accessKeys: [managedKey] }));
  });

  it("round trips access key limit periods and call scopes", async () => {
    await useTempHome();
    const state = walletState({
      accessKeys: [
        {
          ...walletState().accessKeys[0]!,
          limits: [
            { token: usdc, limit: 100000000n, period: 86_400 },
            {
              token: "0x1111111111111111111111111111111111111111",
              limit: 2500000n,
            },
          ],
          scopes: [
            {
              address: usdc,
              selector: "transfer(address,uint256)",
              recipients: [testWallet2],
            },
            {
              address: "0x1111111111111111111111111111111111111111",
              recipients: [],
            },
          ],
        },
      ],
    });

    await saveWalletState(state);

    expect(await loadWalletState()).toEqual(state);
  });

  it("round trips explicit empty access key scopes", async () => {
    await useTempHome();
    const state = walletState({
      accessKeys: [
        {
          ...walletState().accessKeys[0]!,
          scopes: [],
        },
      ],
    });

    await saveWalletState(state);

    expect(await loadWalletState()).toEqual(state);
  });

  it("migrates legacy TOML with comments, escaped strings, booleans, and CRLF line endings", async () => {
    await useTempHome();
    await writeLegacyKeysToml(
      [
        "# Tempo wallet keys",
        "[[keys]]",
        `wallet_address = "${testWallet}" # comment outside string`,
        "chain_id = 4217",
        'key_type = "p256"',
        `key_address = "${testAccessKey}"`,
        `key = "${testPrivateKey}"`,
        'key_authorization = "0x12#34"',
        "provisioned = true",
        "expiry = 2000000000",
        "",
        "[[keys.limits]]",
        `currency = "${usdc}"`,
        'limit = "100000000"',
        "",
      ].join("\r\n"),
    );

    expect(await loadWalletState()).toEqual(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            keyAuthorization: "0x12#34",
            keyType: "p256",
          },
        ],
      }),
    );
  });

  it("uses the first migrated key chain and persists migration once", async () => {
    await useTempHome();
    await writeLegacyKeysToml(`
[[keys]]
wallet_address = "${testWallet}"
chain_id = 42431
key_address = "${testAccessKey}"
key = "${testPrivateKey}"

[[keys]]
wallet_address = "${testWallet2}"
chain_id = 4217
key_address = "${testAccessKey2}"
key = "${testPrivateKey2}"
`);

    const migrated = await loadWalletState();
    expect(migrated.chainId).toBe(42431);
    expect(migrated.accounts).toEqual([{ address: testWallet }, { address: testWallet2 }]);
    expect(await walletStoreExists()).toBe(true);

    await writeLegacyKeysToml(`
[[keys]]
wallet_address = "${testWallet2}"
chain_id = 4217
key_address = "${testAccessKey2}"
key = "${testPrivateKey2}"
`);

    expect(await loadWalletState()).toEqual(migrated);
  });

  it("ignores legacy limits that are outside a key or missing required fields", async () => {
    await useTempHome();
    await writeLegacyKeysToml(`
[[keys.limits]]
currency = "${usdc}"
limit = "999"

[[keys]]
wallet_address = "${testWallet}"
chain_id = 4217
key_address = "${testAccessKey}"
key = "${testPrivateKey}"

[[keys.limits]]
currency = "${usdc}"

[[keys.limits]]
limit = "100000000"
`);

    expect(await loadWalletState()).toEqual(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            expiry: undefined,
            keyAuthorization: undefined,
            limits: [],
          },
        ],
        chainId: 4217,
      }),
    );
  });
});

async function expectMode(path: string, mode: number) {
  if (process.platform === "win32") return;
  expect((await stat(path)).mode & 0o777).toBe(mode);
}
