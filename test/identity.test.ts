import { afterEach, describe, expect, it, vi } from "vitest";
import { Actions } from "viem/tempo";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(async () => 0n),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract: mocks.readContract })),
  };
});

vi.mock("viem/tempo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/tempo")>();
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      accessKey: {
        ...actual.Actions.accessKey,
        revoke: vi.fn(),
      },
    },
  };
});

import {
  currentWhoamiOutput,
  currentKeysOutput,
  keysHandler,
  logoutHandler,
  revokeHandler,
  whoamiHandler,
} from "../src/commands/identity.js";
import { accessKeyAuthorizationSeconds, connect } from "../src/provider.js";
import { moderatoToken } from "../src/shared/constants.js";
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
  mocks.readContract.mockReset();
  mocks.readContract.mockResolvedValue(0n);
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
  it("whoami queries and formats the PathUSD balance on testnet", async () => {
    await useTempHome();
    await writeWalletState(
      walletState({
        accessKeys: [],
        chainId: 42431,
      }),
    );
    mocks.readContract.mockResolvedValueOnce(1_000_004_996_912n);

    const result = await whoamiHandler({ network: "testnet" });

    expect(mocks.readContract).toHaveBeenCalledWith({
      address: moderatoToken,
      abi: expect.any(Array),
      functionName: "balanceOf",
      args: [testWallet],
    });
    expect(result).toMatchObject({
      ready: true,
      balance: {
        total: "1000004.996912",
        available: "1000004.996912",
        symbol: "PathUSD",
      },
    });
  });

  it("uses the PathUSD symbol for an unavailable testnet balance", async () => {
    const result = await currentWhoamiOutput({
      walletAddress: null,
      chain: 42431,
      accessKeys: [],
      network: "testnet",
    });

    expect(result.balance.symbol).toBe("PathUSD");
  });

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

  it("keys output preserves explicit empty scopes", async () => {
    const result = await currentKeysOutput({
      walletAddress: null,
      chain: 4217,
      accessKeys: [
        {
          ...walletState().accessKeys[0]!,
          keyAuthorization: {
            scopes: [{ address: usdc, recipients: [testWallet2] }],
          },
          scopes: [],
        },
      ],
    });

    expect(result.keys[0]).toMatchObject({
      scopes: [],
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
    {
      name: "managed pending",
      overrides: {
        expiry: 4_102_444_800,
        handle: { jwk: { crv: "P-256", kty: "EC" }, kind: "webcrypto-p256" },
        keyAuthorization: { signature: "0x1234" },
        keyType: "p256",
        privateKey: undefined,
        publicKey: "0x04abcd",
      },
      status: "pending",
    },
    {
      name: "managed ready",
      overrides: {
        expiry: 4_102_444_800,
        handle: { jwk: { crv: "P-256", kty: "EC" }, kind: "webcrypto-p256" },
        keyType: "p256",
        privateKey: undefined,
        publicKey: "0x04abcd",
      },
      status: "ready",
    },
  ])("keys output reports $name local key status", async ({ overrides, status }) => {
    const result = await currentKeysOutput({
      walletAddress: null,
      chain: 4217,
      accessKeys: [{ ...walletState().accessKeys[0]!, ...overrides }],
    });

    expect(result.keys[0]?.status).toBe(status);
  });

  it("dry-runs access key revocation without calling the provider", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const createProvider = vi.fn();

    const result = await revokeHandler(
      { accessKey: testAccessKey },
      { "dry-run": true },
      createProvider,
    );

    expect(result).toEqual({
      status: "dry_run",
      wallet: testWallet.toLowerCase(),
      access_key: testAccessKey.toLowerCase(),
      local_key_removed: false,
    });
    expect(createProvider).not.toHaveBeenCalled();
    expect((await loadWalletState()).accessKeys).toHaveLength(1);
  });

  it("revokes an access key and removes the local key", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const account = { address: testWallet };
    const chain = { id: 4217 };
    const client = { chain, request: vi.fn() };
    const provider = {
      getAccount: vi.fn(() => account),
      getClient: vi.fn(() => client),
    };
    const revoke = vi.mocked(Actions.accessKey.revoke);
    revoke.mockClear();
    revoke.mockResolvedValue("0x123" as never);

    const result = await revokeHandler({ accessKey: testAccessKey }, {}, () => provider as never);

    expect(provider.getAccount).toHaveBeenCalledWith({
      address: testWallet,
      signable: true,
    });
    expect(provider.getClient).toHaveBeenCalledWith({ chainId: 4217 });
    expect(revoke).toHaveBeenCalledWith(client, {
      account,
      accessKey: testAccessKey,
      chain,
    });
    expect(result).toEqual({
      status: "success",
      wallet: testWallet.toLowerCase(),
      access_key: testAccessKey.toLowerCase(),
      local_key_removed: true,
    });
    expect((await loadWalletState()).accessKeys).toEqual([]);
  });

  it("only removes the revoked local key for the active wallet and chain", async () => {
    await useTempHome();
    const key = walletState().accessKeys[0]!;
    const otherWalletKey = {
      ...key,
      access: testWallet2,
      privateKey: testPrivateKey2,
    };
    const otherChainKey = {
      ...key,
      chainId: 42431,
      privateKey: testPrivateKey2,
    };
    await writeWalletState(
      walletState({
        accessKeys: [key, otherWalletKey, otherChainKey],
      }),
    );
    const provider = {
      getAccount: vi.fn(),
      getClient: vi.fn(),
    };
    const revokeAccessKey = vi.fn().mockResolvedValue(undefined);

    const result = await revokeHandler(
      { accessKey: testAccessKey },
      {},
      () => provider as never,
      revokeAccessKey,
    );

    expect(revokeAccessKey).toHaveBeenCalledWith({
      provider,
      walletAddress: testWallet,
      accessKeyAddress: testAccessKey,
      chainId: 4217,
    });
    expect(result).toMatchObject({ local_key_removed: true });
    expect((await loadWalletState()).accessKeys).toEqual([otherWalletKey, otherChainKey]);
  });

  it("rejects malformed access key addresses", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    try {
      await revokeHandler({ accessKey: "not-an-address" }, {});
      expect.unreachable("expected revokeHandler to throw");
    } catch (error) {
      expectUsageError(error, "Invalid access key address: expected a 0x address");
    }
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
              keyType: "secp256k1",
            },
          },
        },
      ],
    });
  });
});
