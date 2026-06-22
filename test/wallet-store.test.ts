import { readFile } from "node:fs/promises";
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
  writeRawWalletStore,
} from "./helpers.js";

describe("wallet store file", () => {
  it("resolves under the active HOME", async () => {
    const home = await useTempHome();

    expect(walletStorePath()).toBe(join(home, ".tempo", "wallet", "store.json"));
  });

  it("saves the current envelope with default active account and chain", async () => {
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

  it("loads an empty state from missing or malformed envelopes", async () => {
    await useTempHome();

    expect(await loadWalletState()).toEqual(emptyWalletState());

    for (const body of [
      "{}",
      '{"tempo-cli.store": null}',
      '{"tempo-cli.store": {}}',
      '{"tempo-cli.store": {"state": null}}',
      '{"tempo-cli.store": {"state": "not-an-object"}}',
    ]) {
      await writeRawWalletStore(body);
      expect(await loadWalletState()).toEqual(emptyWalletState());
    }
  });

  it("filters malformed accounts, keys, limits, and optional scalar fields", async () => {
    await useTempHome();
    await writeRawWalletStore(
      JSON.stringify({
        "tempo-cli.store": {
          state: {
            accounts: [{ address: testWallet }, { address: 42 }, null, { other: testWallet2 }],
            activeAccount: "0",
            chainId: "4217",
            accessKeys: [
              {
                access: testWallet,
                address: testAccessKey,
                chainId: 4217,
                expiry: "1783809942",
                keyAuthorization: {
                  address: testAccessKey,
                  nested: ["100#__bigint", { limit: "250#__bigint" }],
                },
                keyType: 1,
                privateKey: false,
                limits: [
                  { token: usdc, limit: "100000000#__bigint", period: 86_400 },
                  { token: usdc, limit: 100000000 },
                  { token: 1, limit: "100000000#__bigint" },
                  { token: usdc, limit: "250000000#__bigint", period: "86400" },
                  null,
                ],
                scopes: [
                  {
                    address: usdc,
                    selector: "transfer(address,uint256)",
                    recipients: [testWallet2, 42],
                  },
                  { address: 42 },
                  null,
                ],
              },
              {
                access: testWallet,
                address: testAccessKey2,
                chainId: "4217",
                limits: [],
              },
              {
                access: testWallet,
                chainId: 4217,
                limits: [],
              },
              null,
            ],
          },
          version: 0,
        },
      }),
    );

    expect(await loadWalletState()).toEqual({
      accounts: [{ address: testWallet }],
      accessKeys: [
        {
          access: testWallet,
          address: testAccessKey,
          chainId: 4217,
          expiry: undefined,
          keyAuthorization: {
            address: testAccessKey,
            nested: [100n, { limit: 250n }],
          },
          keyType: undefined,
          privateKey: undefined,
          limits: [{ token: usdc, limit: "100000000#__bigint", period: 86_400 }],
          scopes: [
            {
              address: usdc,
              selector: "transfer(address,uint256)",
              recipients: [testWallet2],
            },
          ],
        },
      ],
      activeAccount: undefined,
      chainId: undefined,
    });
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

  it("round trips access key limit periods and call scopes", async () => {
    await useTempHome();
    const state = walletState({
      accessKeys: [
        {
          ...walletState().accessKeys[0]!,
          limits: [
            { token: usdc, limit: "100000000#__bigint", period: 86_400 },
            {
              token: "0x1111111111111111111111111111111111111111",
              limit: "2500000#__bigint",
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

  it("can save a state after loading revived bigint authorizations", async () => {
    await useTempHome();
    await writeRawWalletStore(
      JSON.stringify({
        "tempo-cli.store": {
          state: {
            accounts: [{ address: testWallet }],
            activeAccount: 0,
            accessKeys: [
              {
                access: testWallet,
                address: testAccessKey,
                chainId: 4217,
                keyAuthorization: { chainId: "4217#__bigint" },
                limits: [{ token: usdc, limit: "100000000#__bigint" }],
                privateKey: testPrivateKey,
              },
            ],
            chainId: 4217,
          },
          version: 0,
        },
      }),
    );

    const loaded = await loadWalletState();
    await saveWalletState(loaded);

    expect(await loadWalletState()).toEqual(loaded);
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
        "expiry = 1783809942",
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
