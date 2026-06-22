import { afterEach, describe, expect, it, vi } from "vitest";

import {
  currentKeysOutput,
  keysHandler,
  logoutHandler,
  whoamiHandler,
} from "../src/commands/identity.js";
import { accessKeyAuthorizationSeconds, connect } from "../src/provider.js";
import { emptyWalletState, loadWalletState, saveWalletState } from "../src/wallet/store.js";

import {
  expectUsageError,
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
  writeWalletState,
} from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("wallet store", () => {
  it("loads an empty store when none exists", async () => {
    await useTempHome();
    const state = await loadWalletState();
    expect(state).toEqual(emptyWalletState());
    expect(await walletStoreExists()).toBe(false);
  });

  it("round trips save then load", async () => {
    await useTempHome();
    const state = walletState();
    await saveWalletState(state);
    const loaded = await loadWalletState();
    expect(loaded).toEqual(state);
  });

  it("migrates legacy keys.toml when store.json is absent", async () => {
    await useTempHome();
    await writeLegacyKeysToml(`
[[keys]]
wallet_type = "passkey"
wallet_address = "${testWallet}"
chain_id = 4217
key_type = "secp256k1"
key_address = "${testAccessKey}"
key = "${testPrivateKey}"
key_authorization = "0x1234"
provisioned = true
expiry = 1783809942

[[keys.limits]]
currency = "0x20C000000000000000000000b9537d11c60E8b50"
limit = "100000000"
`);

    const state = await loadWalletState();

    expect(state).toEqual(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            keyAuthorization: "0x1234",
          },
        ],
      }),
    );
    expect(await readWalletStoreJson()).toMatchObject({
      "tempo-cli.store": {
        state: {
          accounts: [{ address: testWallet }],
          accessKeys: [
            {
              access: testWallet,
              address: testAccessKey,
              chainId: 4217,
              keyAuthorization: "0x1234",
              keyType: "secp256k1",
              limits: [{ limit: "100000000#__bigint" }],
            },
          ],
        },
      },
    });
  });

  it("migrates multiple legacy keys while preserving order and deduplicating accounts", async () => {
    await useTempHome();
    await writeLegacyKeysToml(`
# Managed by the old wallet CLI.
[[keys]]
wallet_address = "${testWallet}" # inline comments are ignored
chain_id = 4217
key_address = "${testAccessKey}"
key = "${testPrivateKey}"
expiry = 1783809942

[[keys.limits]]
currency = "${usdc}"
limit = "100000000"

[[keys.limits]]
currency = "0x1111111111111111111111111111111111111111"
limit = "2500000"

[[keys]]
wallet_address = "${testWallet}"
chain_id = 4217
key_address = "${testAccessKey2}"
key = "${testPrivateKey2}"

[[keys]]
wallet_type = "passkey"
wallet_address = "${testWallet2}"
chain_id = 42431
key_type = "p256"
key_address = "${testAccessKey2}"
key = "${testPrivateKey2}"
`);

    const state = await loadWalletState();

    expect(state.accounts).toEqual([{ address: testWallet }, { address: testWallet2 }]);
    expect(state.activeAccount).toBe(0);
    expect(state.chainId).toBe(4217);
    expect(state.accessKeys).toEqual([
      {
        access: testWallet,
        address: testAccessKey,
        chainId: 4217,
        expiry: 1783809942,
        keyAuthorization: undefined,
        keyType: "secp256k1",
        privateKey: testPrivateKey,
        limits: [
          { token: usdc, limit: "100000000#__bigint" },
          { token: "0x1111111111111111111111111111111111111111", limit: "2500000#__bigint" },
        ],
      },
      {
        access: testWallet,
        address: testAccessKey2,
        chainId: 4217,
        expiry: undefined,
        keyAuthorization: undefined,
        keyType: "secp256k1",
        privateKey: testPrivateKey2,
        limits: [],
      },
      {
        access: testWallet2,
        address: testAccessKey2,
        chainId: 42431,
        expiry: undefined,
        keyAuthorization: undefined,
        keyType: "p256",
        privateKey: testPrivateKey2,
        limits: [],
      },
    ]);
  });

  it("does not create store.json when legacy keys.toml has no migratable keys", async () => {
    await useTempHome();
    await writeLegacyKeysToml(`
[[keys]]
wallet_address = "${testWallet}"
key = "${testPrivateKey}"

[[keys]]
chain_id = 4217
key_address = "${testAccessKey}"
`);

    expect(await loadWalletState()).toEqual(emptyWalletState());
    expect(await walletStoreExists()).toBe(false);
  });

  it("does not fall back to legacy keys when store.json is corrupt", async () => {
    await useTempHome();
    await writeRawWalletStore("{not-json");
    await writeLegacyKeysToml(`
[[keys]]
wallet_address = "${testWallet}"
chain_id = 4217
key_address = "${testAccessKey}"
key = "${testPrivateKey}"
`);

    await expect(loadWalletState()).rejects.toThrow(SyntaxError);
  });

  it("prefers store.json over legacy keys.toml", async () => {
    await useTempHome();
    await writeWalletState(emptyWalletState());
    await writeLegacyKeysToml(`
[[keys]]
wallet_address = "${testWallet}"
chain_id = 4217
key_address = "${testAccessKey}"
key = "${testPrivateKey}"
`);

    expect(await loadWalletState()).toMatchObject(emptyWalletState());
  });
});

describe("identity commands", () => {
  it("whoami reports ready with a wallet", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await whoamiHandler({});
    expect(result).toMatchObject({
      ready: true,
      wallet: testWallet.toLowerCase(),
    });
  });

  it("whoami reports ready after migrating legacy keys.toml", async () => {
    await useTempHome();
    await writeLegacyKeysToml(`
[[keys]]
wallet_address = "${testWallet}"
chain_id = 4217
key_address = "${testAccessKey}"
key = "${testPrivateKey}"

[[keys.limits]]
currency = "${usdc}"
limit = "100000000"
`);

    const result = await whoamiHandler({});

    expect(result).toMatchObject({
      ready: true,
      wallet: testWallet.toLowerCase(),
      key: {
        address: testAccessKey.toLowerCase(),
        chain_id: 4217,
        token: usdc.toLowerCase(),
      },
    });
  });

  it("whoami --network testnet returns ready false for a mainnet store", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await whoamiHandler({ network: "testnet" });
    expect(result).toEqual({ ready: false });
  });

  it("whoami --credits without a wallet throws E_USAGE", async () => {
    await useTempHome();

    try {
      await whoamiHandler({ credits: true });
      expect.unreachable("expected whoami --credits to throw");
    } catch (error) {
      expectUsageError(
        error,
        "Configuration missing: No wallet configured. Run 'tempo wallet login'.",
      );
    }
  });

  it("keys outputs the basic shape", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await keysHandler();
    expect(result.total).toBe(1);
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0]).toMatchObject({
      address: testAccessKey.toLowerCase(),
      chain_id: 4217,
      wallet_address: testWallet.toLowerCase(),
    });
  });

  it("keys output includes all spending limits, periods, scopes, and local status", async () => {
    const result = await currentKeysOutput({
      walletAddress: null,
      chain: 4217,
      accessKeys: [
        {
          ...walletState().accessKeys[0]!,
          expiry: 4_102_444_800,
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
          ],
        },
      ],
    });

    expect(result.keys[0]).toMatchObject({
      status: "ready",
      spending_limit: {
        limit: "100.000000",
        period_seconds: 86_400,
      },
      spending_limits: [
        {
          limit: "100.000000",
          period_seconds: 86_400,
          token: usdc.toLowerCase(),
        },
        {
          limit: "2.500000",
          period_seconds: null,
          token: "0x1111111111111111111111111111111111111111",
        },
      ],
      scopes: [
        {
          address: usdc.toLowerCase(),
          selector: "transfer(address,uint256)",
          recipients: [testWallet2.toLowerCase()],
        },
      ],
    });
  });

  it.each([
    {
      name: "expired",
      overrides: { expiry: 1 },
      status: "expired",
    },
    {
      name: "unusable",
      overrides: { expiry: 4_102_444_800, privateKey: undefined },
      status: "unusable",
    },
    {
      name: "pending",
      overrides: { expiry: 4_102_444_800, keyAuthorization: { signature: "0x1234" } },
      status: "pending",
    },
  ])("keys output reports $name local key status", async ({ overrides, status }) => {
    const result = await currentKeysOutput({
      walletAddress: null,
      chain: 4217,
      accessKeys: [{ ...walletState().accessKeys[0]!, ...overrides }],
    });

    expect(result.keys[0]?.status).toBe(status);
  });

  it("logout clears the store", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await logoutHandler();
    expect(result).toMatchObject({
      logged_in: true,
      disconnected: true,
      wallet: testWallet.toLowerCase(),
    });

    expect(await loadWalletState()).toMatchObject({ accounts: [], accessKeys: [] });
    expect(await readWalletStoreJson()).toMatchObject({
      "tempo-cli.store": { state: { accounts: [], accessKeys: [] } },
    });
  });

  it("requests 30-day access keys when connecting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T00:00:00Z"));
    const request = vi.fn().mockResolvedValue({ accounts: [] });

    await connect({ request } as never);

    expect(request).toHaveBeenCalledWith({
      method: "wallet_connect",
      params: [
        {
          capabilities: {
            authorizeAccessKey: {
              expiry: Math.floor(Date.now() / 1000) + accessKeyAuthorizationSeconds,
            },
          },
        },
      ],
    });
  });
});
