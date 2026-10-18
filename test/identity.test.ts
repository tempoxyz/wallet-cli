import { afterEach, describe, expect, it, vi } from "vitest";
import { toHex } from "viem";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(async () => 0n),
  fetch: vi.fn(async () => new Response("[]", { status: 200 })),
  getMetadata: vi.fn(
    async (
      _client: unknown,
      _parameters: { token: string },
    ): Promise<{ decimals: number; symbol: string }> => {
      throw new Error("no metadata");
    },
  ),
}));

vi.stubGlobal("fetch", mocks.fetch);

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    // The RPC serves whichever chain the client asks for, so reads pass the TEMPO_RPC_URL check.
    createPublicClient: vi.fn((options: { chain: { id: number } }) => ({
      readContract: mocks.readContract,
      getChainId: async () => options.chain.id,
    })),
  };
});

vi.mock("viem/tempo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/tempo")>();
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      token: { ...actual.Actions.token, getMetadata: mocks.getMetadata },
    },
  };
});

import { currentKeysOutput, keysHandler, updateAccessKeyHandler } from "../src/commands/keys.js";
import { currentWhoamiOutput, whoamiHandler } from "../src/commands/whoami.js";
import { accessKeyAuthorizationSeconds, connect } from "../src/provider.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { machToken } from "../src/shared/mach.js";
import { appUrl, parseNetwork } from "../src/shared/network.js";
import { upsertSessionRecord, type PersistedSessionRecord } from "../src/payment/session-store.js";
import { emptyWalletState, loadWalletState, saveWalletState } from "../src/wallet/store.js";
import { keysOutput } from "../src/schemas/keys.js";
import { whoamiOutput } from "../src/schemas/whoami.js";

import {
  containsSymbol,
  expectTokenError,
  expectUsageError,
  invalidTokenInputs,
  ousdToken,
  readWalletStoreJson,
  readyWallet,
  testAccessKey,
  testAccessKey2,
  testPrivateKey,
  testPrivateKey2,
  testWallet,
  testWallet2,
  tokenInputs,
  unlistedToken,
  untrustedSymbols,
  useTempHome,
  usdc,
  walletState,
  walletStoreExists,
  writeLegacyKeysToml,
  writeRawWalletStore,
  writeWalletState,
} from "./helpers.js";

/** cbBTC is a 6-decimal TIP-20 token on Tempo, as viem lists it and as it reports on chain. */
const cbBtcToken = "0x20c000000000000000000000c412ec89d0c08be5";

afterEach(() => {
  vi.useRealTimers();
  mocks.readContract.mockReset();
  mocks.readContract.mockResolvedValue(0n);
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue(new Response("[]", { status: 200 }));
  mocks.getMetadata.mockReset();
  mocks.getMetadata.mockRejectedValue(new Error("no metadata"));
});

describe("wallet store", () => {
  it.each([
    {
      name: "omitted",
      limits: undefined,
      scopes: undefined,
      mode: "unrestricted",
      unlimited: true,
      limit: null,
    },
    { name: "empty", limits: [], scopes: [], mode: "none", unlimited: false, limit: "0" },
    {
      name: "bounded",
      limits: [{ token: usdc, limit: "100000000#__bigint" }],
      scopes: [{ address: usdc }],
      mode: "restricted",
      unlimited: false,
      limit: "100",
    },
  ])(
    "preserves $name permissions through save, reload, and output",
    async ({ limits, scopes, mode, unlimited, limit }) => {
      await useTempHome();
      await saveWalletState(
        walletState({
          accessKeys: [{ ...walletState().accessKeys[0]!, permissionSemantics: 1, limits, scopes }],
        }),
      );
      const state = await loadWalletState();
      const result = keysOutput.parse(
        await currentKeysOutput({ walletAddress: testWallet, accessKeys: state.accessKeys }),
      );
      expect(result.keys[0]).toMatchObject({
        spending_limit: { mode, unlimited, limit, remaining: null, spent: null },
        call_permissions: mode,
      });
      expect(state.accessKeys[0]?.limits).toEqual(limits);
      expect(state.accessKeys[0]?.scopes).toEqual(scopes);
      const identity = await currentWhoamiOutput({
        walletAddress: testWallet,
        chain: 4217,
        accessKeys: state.accessKeys,
      });
      expect(whoamiOutput.options[1].parse(identity)).toMatchObject({
        key: { spending_limit: { mode, unlimited, limit }, call_permissions: mode },
      });
    },
  );

  it.each([
    { name: "omitted", limits: undefined, limit: null },
    { name: "empty", limits: [], limit: null },
    {
      name: "bounded",
      limits: [{ token: usdc, limit: "100000000#__bigint" }],
      limit: "100",
    },
  ])("keeps legacy $name permissions unknown through a round trip", async ({ limits, limit }) => {
    await useTempHome();
    await saveWalletState(
      walletState({ accessKeys: [{ ...walletState().accessKeys[0]!, limits, scopes: [] }] }),
    );
    const state = await loadWalletState();
    expect(state.accessKeys[0]?.permissionSemantics).toBeUndefined();
    const result = await currentKeysOutput({
      walletAddress: testWallet,
      accessKeys: state.accessKeys,
    });
    expect(result.keys[0]).toMatchObject({
      spending_limit: { mode: "unknown", unlimited: null, limit },
      call_permissions: "unknown",
    });
  });

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
            expiry: 1783809942,
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
  it("whoami queries and formats the pathUSD balance on testnet", async () => {
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
      ready: false,
      balance: {
        total: "1000004.996912",
        available: "1000004.996912",
        symbol: "pathUSD",
      },
    });
  });

  it("keeps closing reserves in pending_refund until they return to the wallet", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    mocks.readContract.mockResolvedValue(1_000_000n);
    const channel = identitySession();
    await upsertSessionRecord(channel);
    expect(await whoamiHandler({})).toMatchObject({
      balance: {
        total: "1.008",
        available: "1",
        locked: "0.008",
        pending_refund: "0",
        active_sessions: 1,
      },
    });

    for (const state of ["closing", "finalizable"]) {
      await upsertSessionRecord({ ...channel, state, close_requested_at: 1 });
      expect(await whoamiHandler({})).toMatchObject({
        balance: {
          total: "1.008",
          available: "1",
          locked: "0",
          pending_refund: "0.008",
          active_sessions: 0,
        },
      });
    }

    await upsertSessionRecord({ ...channel, state: "finalized", close_requested_at: 1 });
    mocks.readContract.mockResolvedValue(1_008_000n);
    expect(await whoamiHandler({})).toMatchObject({
      balance: {
        total: "1.008",
        available: "1.008",
        locked: "0",
        pending_refund: "0",
        active_sessions: 0,
      },
    });
  });

  it("scopes pending refunds to the wallet and token and uses the highest spent amount", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const records = [
      identitySession({ state: "closing", close_requested_at: 1, server_spent: 3_000n }),
      identitySession({ state: "finalizable", close_requested_at: 1, accepted_cumulative: 4_000n }),
      identitySession({ state: "closing", close_requested_at: 1, cumulative_amount: 11_000n }),
      identitySession({ state: "closing", close_requested_at: 1, payer: testWallet2 }),
      identitySession({ state: "closing", close_requested_at: 1, token: moderatoToken }),
      identitySession({ state: "finalized", close_requested_at: 1 }),
      identitySession(),
    ];
    for (const [index, record] of records.entries()) {
      await upsertSessionRecord({ ...record, channel_id: `0x${String(index + 1).repeat(64)}` });
    }

    expect(await whoamiHandler({})).toMatchObject({
      balance: {
        total: "0.021",
        available: "0",
        locked: "0.008",
        pending_refund: "0.013",
        active_sessions: 1,
      },
    });
  });

  it("uses the pathUSD symbol for an unavailable testnet balance", async () => {
    const result = await currentWhoamiOutput({
      walletAddress: null,
      chain: 42431,
      accessKeys: [],
    });

    expect(result.balance.symbol).toBe("pathUSD");
  });

  it.each([
    { name: "MACH", chain: 4217, token: machToken(4217), symbol: "MACH" },
    {
      name: "OUSD",
      chain: 4217,
      token: "0x20c0000000000000000000006a37DA5C996874BE",
      symbol: "OUSD",
    },
    { name: "pathUSD on testnet", chain: 42431, token: moderatoToken, symbol: "pathUSD" },
    {
      name: "an unlisted token's sanitized on-chain symbol",
      chain: 4217,
      token: unlistedToken,
      metadata: { decimals: 6, symbol: "\u001b]0;title\u0007EVIL\u200b\u202e" },
      symbol: "EVIL",
    },
    {
      name: "no symbol for an unreadable unlisted token",
      chain: 4217,
      token: unlistedToken,
      symbol: null,
    },
  ])(
    "whoami and keys show $name, never the address",
    async ({ chain, token, metadata, symbol }) => {
      if (metadata) mocks.getMetadata.mockResolvedValue(metadata);
      const key = {
        ...walletState().accessKeys[0]!,
        chainId: chain,
        permissionSemantics: 1 as const,
        limits: [{ token, limit: "100000000#__bigint" }],
      };

      const whoami = await currentWhoamiOutput({
        walletAddress: testWallet,
        chain,
        accessKeys: [key],
      });
      const keys = await currentKeysOutput({ walletAddress: testWallet, accessKeys: [key] });

      const shown = { symbol, token: token.toLowerCase() };
      expect(whoamiOutput.options[1].parse(whoami)).toMatchObject({
        balance: { symbol },
        balances: [shown],
        key: { ...shown, spending_limits: [shown] },
      });
      expect(keysOutput.parse(keys).keys).toMatchObject([{ ...shown, spending_limits: [shown] }]);
      expect(mocks.getMetadata.mock.calls.map(([, parameters]) => parameters)).toEqual(
        token === unlistedToken ? [{ token }, { token }] : [],
      );
    },
  );

  it.each([
    { name: "USDC.e", token: usdc, limit: "100000000", shown: "100" },
    {
      name: "an unlisted 2-decimal token",
      token: unlistedToken,
      decimals: 2,
      limit: "1021",
      shown: "10.21",
    },
    {
      name: "an unlisted 18-decimal token",
      token: unlistedToken,
      decimals: 18,
      limit: "1500000000000000000",
      shown: "1.5",
    },
    // Without decimals the scale is unknown, so only the stored base units are shown.
    { name: "an unreadable unlisted token", token: unlistedToken, limit: "100000000", shown: null },
  ])(
    "shows a limit for $name in its decimals in whoami and keys",
    async ({ token, decimals, limit, shown }) => {
      if (decimals !== undefined) mocks.getMetadata.mockResolvedValue({ decimals, symbol: "TKN" });
      const key = {
        ...walletState().accessKeys[0]!,
        permissionSemantics: 1 as const,
        limits: [{ token, limit: `${limit}#__bigint` }],
      };

      const whoami = await currentWhoamiOutput({
        walletAddress: testWallet,
        chain: 4217,
        accessKeys: [key],
      });
      const keys = await currentKeysOutput({ walletAddress: testWallet, accessKeys: [key] });

      for (const output of [whoami.key, keys.keys[0]])
        expect(output).toMatchObject({
          spending_limit: { mode: "restricted", limit: shown, raw_limit: limit },
          spending_limits: [{ limit: shown, raw_limit: limit }],
        });
    },
  );

  it("reads no token metadata for another wallet's keys and shows their unlisted limits raw", async () => {
    mocks.getMetadata.mockResolvedValue({ decimals: 2, symbol: "TKN" });
    const key = {
      ...walletState().accessKeys[0]!,
      access: testWallet2,
      permissionSemantics: 1 as const,
      limits: [
        { token: unlistedToken, limit: "1021#__bigint" },
        { token: usdc, limit: "5000000#__bigint" },
      ],
    };

    const result = keysOutput.parse(
      await currentKeysOutput({ walletAddress: testWallet, accessKeys: [key] }),
    );

    expect(result.keys[0]).toMatchObject({
      wallet: testWallet2.toLowerCase(),
      symbol: null,
      balance: null,
      spending_limit: { limit: null, raw_limit: "1021" },
      spending_limits: [
        { symbol: null, token: unlistedToken, limit: null, raw_limit: "1021" },
        { symbol: "USDC.e", token: usdcToken, limit: "5", raw_limit: "5000000" },
      ],
    });
    expect(mocks.getMetadata).not.toHaveBeenCalled();
    expect(mocks.readContract).not.toHaveBeenCalled();
  });

  it("looks up each unlisted key token once, in parallel, for keys list", async () => {
    const otherToken = "0x20c000000000000000000000000000000000cafe";
    const metadata = Promise.withResolvers<{ decimals: number; symbol: string }>();
    mocks.getMetadata.mockReturnValue(metadata.promise);
    const key = {
      ...walletState().accessKeys[0]!,
      limits: [{ token: unlistedToken, limit: "1000000#__bigint" }],
    };
    const accessKeys = [
      key,
      { ...key, address: testAccessKey2 },
      { ...key, access: testWallet2 },
      { ...key, limits: [{ token: otherToken, limit: "1000000#__bigint" }] },
    ];

    const output = currentKeysOutput({ walletAddress: testWallet, accessKeys });
    try {
      expect(mocks.getMetadata.mock.calls.map(([, parameters]) => parameters)).toEqual([
        { token: unlistedToken },
        { token: otherToken },
      ]);
    } finally {
      metadata.resolve({ decimals: 6, symbol: "NEW" });
    }
    expect((await output).keys.map((output) => output.symbol)).toEqual([
      "NEW",
      "NEW",
      "NEW",
      "NEW",
    ]);
    expect(mocks.getMetadata).toHaveBeenCalledTimes(2);
  });

  it.each(untrustedSymbols)(
    "never shows on-chain or asset symbol %j in whoami or keys",
    async (symbol) => {
      await useTempHome();
      await writeWalletState(walletState());
      mocks.getMetadata.mockResolvedValue({ decimals: 6, symbol });
      mocks.fetch.mockResolvedValueOnce(
        Response.json([
          { address: unlistedToken, balance: "1000000", decimals: 6, symbol, verified: false },
        ]),
      );
      const key = {
        ...walletState().accessKeys[0]!,
        limits: [{ token: unlistedToken, limit: "1000000#__bigint" }],
      };

      const whoami = await currentWhoamiOutput({
        walletAddress: testWallet,
        chain: 4217,
        accessKeys: [key],
      });
      const keys = await currentKeysOutput({ walletAddress: testWallet, accessKeys: [key] });

      const shown = { symbol: null, token: unlistedToken };
      expect(whoami).toMatchObject({
        balance: { symbol: null },
        balances: [shown],
        key: { ...shown, spending_limits: [shown] },
      });
      expect(keys.keys).toMatchObject([{ ...shown, spending_limits: [shown] }]);
      expect(containsSymbol(whoami, symbol)).toBe(false);
      expect(containsSymbol(keys, symbol)).toBe(false);
    },
  );

  it("shows listed symbols for held tokens and sanitizes other asset symbols", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    mocks.readContract.mockResolvedValueOnce(5_000_000n);
    mocks.fetch.mockResolvedValueOnce(
      Response.json([
        { address: ousdToken, balance: "1000000", decimals: 6, symbol: ousdToken, verified: true },
        {
          address: unlistedToken,
          balance: "2000000",
          decimals: 6,
          symbol: "\u001b[31mNEW\u200b",
          verified: false,
        },
      ]),
    );

    const result = await whoamiHandler({});

    expect("balances" in result ? result.balances : null).toMatchObject([
      { token: ousdToken, symbol: "OUSD" },
      { token: unlistedToken, symbol: "NEW" },
      { token: usdcToken, symbol: "USDC.e" },
    ]);
    expect(mocks.getMetadata).not.toHaveBeenCalled();
  });

  it("does not report an RPC error or query a balance without a wallet", async () => {
    const result = await currentWhoamiOutput({
      walletAddress: null,
      chain: 4217,
      accessKeys: [],
    });

    expect(result).toMatchObject({
      ready: false,
      wallet: null,
      balance: { available: null, total: null },
      key: null,
    });
    expect(result.balance).not.toHaveProperty("error");
    expect(mocks.readContract).not.toHaveBeenCalled();
  });

  it("whoami reports ready with a wallet", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await whoamiHandler({});
    expect(result).toMatchObject({
      ready: true,
      wallet: testWallet.toLowerCase(),
      key: { status: "ready" },
    });
  });

  it("whoami reports every held token and its active access-key limit", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    mocks.readContract.mockResolvedValueOnce(5_000_000n);
    mocks.fetch.mockResolvedValueOnce(
      Response.json([
        {
          address: usdc,
          balance: "5000000",
          decimals: 6,
          symbol: "USDC.e",
          verified: true,
        },
        {
          address: moderatoToken,
          balance: "2500000",
          decimals: 6,
          symbol: "pathUSD",
          verified: true,
        },
        {
          address: "0x20c0000000000000000000000000000000000001",
          balance: "0",
          decimals: 6,
          symbol: "ZERO",
          verified: false,
        },
      ]),
    );

    const result = await whoamiHandler({});

    expect(mocks.fetch).toHaveBeenCalledWith(
      new URL(`/api/assets?address=${testWallet}&chainId=4217&fresh=true`, appUrl),
      { signal: expect.any(AbortSignal) },
    );
    expect("balances" in result ? result.balances : null).toEqual([
      {
        token: usdc.toLowerCase(),
        symbol: "USDC.e",
        decimals: 6,
        balance: "5",
        verified: true,
        access_key_limit: "100",
      },
      {
        token: moderatoToken,
        symbol: "pathUSD",
        decimals: 6,
        balance: "2.5",
        verified: true,
        access_key_limit: null,
      },
    ]);
  });

  it("starts asset discovery without waiting for the payment-token RPC", async () => {
    await useTempHome();
    const balance = Promise.withResolvers<bigint>();
    mocks.readContract.mockReturnValueOnce(balance.promise);

    const output = currentWhoamiOutput({
      walletAddress: testWallet,
      chain: 4217,
      accessKeys: walletState().accessKeys,
    });
    try {
      expect(mocks.readContract).toHaveBeenCalledOnce();
      expect(mocks.fetch).toHaveBeenCalledOnce();
    } finally {
      balance.resolve(5_000_000n);
    }
    expect(await output).toMatchObject({
      ready: true,
      balance: { available: "5" },
      balances: [{ token: usdc.toLowerCase(), balance: "5" }],
    });
  });

  it("whoami preserves the payment-token balance when asset discovery fails", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    mocks.readContract.mockResolvedValueOnce(5_000_000n);
    mocks.fetch.mockRejectedValueOnce(new Error("offline"));

    const result = await whoamiHandler({});

    expect("balances" in result ? result.balances : null).toEqual([
      {
        token: usdc.toLowerCase(),
        symbol: "USDC.e",
        decimals: 6,
        balance: "5",
        verified: true,
        access_key_limit: "100",
      },
    ]);
  });

  it.each([
    { name: "a listed token", token: usdc, metadata: undefined, symbol: "USDC.e", verified: true },
    {
      name: "an unlisted token with a listed-looking ticker",
      token: unlistedToken,
      metadata: { decimals: 6, symbol: "USDC" },
      symbol: "USDC",
      verified: false,
    },
  ])(
    "marks the payment-token fallback balance verified only for $name",
    async ({ token, metadata, symbol, verified }) => {
      await useTempHome();
      await writeWalletState(walletState());
      mocks.readContract.mockResolvedValueOnce(5_000_000n);
      mocks.fetch.mockRejectedValueOnce(new Error("offline"));
      if (metadata) mocks.getMetadata.mockResolvedValue(metadata);
      const key = {
        ...walletState().accessKeys[0]!,
        limits: [{ token, limit: "1000000#__bigint" }],
      };

      const whoami = await currentWhoamiOutput({
        walletAddress: testWallet,
        chain: 4217,
        accessKeys: [key],
      });

      expect(whoami.balances).toEqual([
        expect.objectContaining({ token: token.toLowerCase(), symbol, verified }),
      ]);
    },
  );

  it("reports RPC failure as an unknown balance and recovers when the RPC returns", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    await upsertSessionRecord(identitySession());
    await upsertSessionRecord({
      ...identitySession(),
      channel_id: `0x${"b".repeat(64)}`,
      state: "closing",
      close_requested_at: 1,
    });
    mocks.readContract.mockRejectedValue(new Error("RPC unavailable"));

    expect(await whoamiHandler({})).toMatchObject({
      ready: false,
      wallet: testWallet.toLowerCase(),
      balance: {
        total: null,
        available: null,
        locked: "0.008",
        pending_refund: "0.008",
        active_sessions: 1,
        error: { code: "E_RPC" },
      },
      key: { status: "ready", balance: null },
    });
    expect(await keysHandler()).toMatchObject({
      keys: [{ balance: null, balance_error: { code: "E_RPC" } }],
    });

    mocks.readContract.mockResolvedValue(5_000_000n);
    const recovered = await whoamiHandler({});
    expect(recovered).toMatchObject({
      ready: true,
      balance: { total: "5.016", available: "5" },
      key: { balance: "5" },
    });
    expect(recovered).not.toHaveProperty("balance.error");
    const recoveredKeys = await keysHandler();
    expect(recoveredKeys).toMatchObject({ keys: [{ balance: "5" }] });
    expect(recoveredKeys.keys[0]).not.toHaveProperty("balance_error");
  });

  it("distinguishes a successful zero balance from an unavailable balance", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    mocks.readContract.mockResolvedValue(0n);

    const result = await whoamiHandler({});
    expect(result).toMatchObject({
      ready: true,
      balance: { total: "0", available: "0" },
      key: { balance: "0" },
    });
    expect(result).not.toHaveProperty("balance.error");
    if (!("key" in result) || !result.key) expect.unreachable("expected key details");
    expect(result.key).not.toHaveProperty("balance_error");
  });

  it("whoami reports an expired access key as not ready", async () => {
    await useTempHome();
    await writeWalletState(
      walletState({
        accessKeys: [{ ...walletState().accessKeys[0]!, expiry: 1 }],
      }),
    );

    const result = await whoamiHandler({});

    expect(result).toMatchObject({
      ready: false,
      wallet: testWallet.toLowerCase(),
      key: { address: testAccessKey.toLowerCase(), status: "expired" },
    });
  });

  it("whoami selects a later usable access key", async () => {
    await useTempHome();
    await writeWalletState(
      walletState({
        accessKeys: [
          { ...walletState().accessKeys[0]!, expiry: 1 },
          {
            ...walletState().accessKeys[0]!,
            address: testAccessKey2,
            expiry: 2_000_000_000,
            privateKey: testPrivateKey2,
          },
        ],
      }),
    );

    const result = await whoamiHandler({});

    expect(result).toMatchObject({
      ready: true,
      key: { address: testAccessKey2.toLowerCase(), status: "ready" },
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

  it("whoami reports the requested testnet without a configured testnet key", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await whoamiHandler({ network: "testnet" });
    expect(result).toMatchObject({ ready: false, wallet: testWallet.toLowerCase(), key: null });
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: moderatoToken }),
    );
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
      wallet: testWallet.toLowerCase(),
    });
  });

  it("keys output includes all spending limits, periods, scopes, and local status", async () => {
    const result = await currentKeysOutput({
      walletAddress: testWallet,
      accessKeys: [
        {
          ...walletState().accessKeys[0]!,
          permissionSemantics: 1,
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
        limit: "100",
        raw_limit: "100000000",
        period_seconds: 86_400,
      },
      spending_limits: [
        {
          limit: "100",
          raw_limit: "100000000",
          period_seconds: 86_400,
          token: usdc.toLowerCase(),
        },
        {
          // Its metadata is unreadable, so only the stored base units are known.
          limit: null,
          raw_limit: "2500000",
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
      walletAddress: testWallet,
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
      overrides: {
        expiry: 4_102_444_800,
        keyAuthorization: {
          address: testAccessKey,
          chainId: 4217n,
          expiry: 4_102_444_800,
          signature: { type: "secp256k1", signature: "0x1234" },
          type: "secp256k1",
        },
      },
      status: "pending",
    },
    {
      name: "managed pending",
      overrides: {
        expiry: 4_102_444_800,
        handle: { jwk: { crv: "P-256", kty: "EC" }, kind: "webcrypto-p256" },
        keyAuthorization: {
          address: testAccessKey,
          chainId: 4217n,
          expiry: 4_102_444_800,
          signature: { type: "p256", signature: "0x1234" },
          type: "p256",
        },
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
      walletAddress: testWallet,
      accessKeys: [{ ...walletState().accessKeys[0]!, ...overrides }],
    });

    expect(result.keys[0]?.status).toBe(status);
  });

  it("updates the connected access key limit through wallet approval", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const request = vi.fn().mockResolvedValue(undefined);
    const createProvider = vi.fn(async () => ({ request }));

    const result = await updateAccessKeyHandler(
      await readyWallet(),
      { limit: "250", browser: false },
      createProvider,
    );

    expect(createProvider).toHaveBeenCalledWith({
      network: { name: "mainnet", chainId: 4217 },
      noBrowser: true,
    });
    expect(request).toHaveBeenCalledWith({
      method: "wallet_updateAccessKey",
      params: [
        {
          address: testWallet,
          accessKeyAddress: testAccessKey,
          chainId: toHex(4217),
          limits: [{ token: usdcToken, limit: toHex(250_000_000n) }],
        },
      ],
    });
    expect(result).toEqual({
      status: "success",
      wallet: testWallet.toLowerCase(),
      access_key: testAccessKey.toLowerCase(),
      chain_id: 4217,
      network: "tempo",
      token: usdc.toLowerCase(),
      limit: "250",
      instruction: expect.any(String),
      _next: expect.any(Object),
    });
    expect((await loadWalletState()).accessKeys[0]?.limits).toEqual([
      { token: usdc, limit: "250000000#__bigint" },
    ]);
    expect((await loadWalletState()).accessKeys[0]?.permissionSemantics).toBeUndefined();
  });

  it("reports an unrestricted key as restricted after a single-token update", async () => {
    await useTempHome();
    await writeWalletState(
      walletState({
        accessKeys: [
          {
            ...walletState().accessKeys[0]!,
            permissionSemantics: 1,
            limits: undefined,
            scopes: undefined,
          },
        ],
      }),
    );
    const request = vi.fn().mockResolvedValue(undefined);
    await updateAccessKeyHandler(await readyWallet(), { limit: "250", token: usdc }, async () => ({
      request,
    }));
    const state = await loadWalletState();
    const result = await currentKeysOutput({
      walletAddress: testWallet,
      accessKeys: state.accessKeys,
    });
    expect(result.keys[0]).toMatchObject({
      spending_limit: { mode: "restricted", unlimited: false, limit: "250" },
      call_permissions: "unrestricted",
      spending_limits: [{ token: usdc.toLowerCase(), limit: "250" }],
    });
  });

  it("uses the stored testnet chain for wallet approval", async () => {
    await useTempHome();
    const key = {
      ...walletState().accessKeys[0]!,
      chainId: 42431,
      limits: [{ token: moderatoToken, limit: "100000000#__bigint" }],
    };
    await writeWalletState(walletState({ accessKeys: [key], chainId: 42431 }));
    const request = vi.fn().mockResolvedValue(undefined);
    const createProvider = vi.fn(async () => ({ request }));

    await updateAccessKeyHandler(await readyWallet(), { limit: "250" }, createProvider);

    expect(createProvider).toHaveBeenCalledWith({
      network: { name: "testnet", chainId: 42431 },
      noBrowser: false,
    });
  });

  it("preserves local limits when wallet approval fails", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const request = vi.fn().mockRejectedValue(new Error("rejected"));

    await expect(
      updateAccessKeyHandler(await readyWallet(), { limit: "250" }, async () => ({ request })),
    ).rejects.toThrow("rejected");
    expect((await loadWalletState()).accessKeys[0]?.limits).toEqual([
      { token: usdc, limit: "100000000#__bigint" },
    ]);
  });

  it.each([
    { name: "a selected access key", first: {}, accessKey: testAccessKey2 },
    { name: "a selected expired access key", first: {}, accessKey: testAccessKey2, expiry: 1 },
  ])("updates $name", async ({ first: overrides, accessKey, expiry = 2_000_000_000 }) => {
    await useTempHome();
    const first = { ...walletState().accessKeys[0]!, ...overrides };
    const selected = { ...first, address: testAccessKey2, privateKey: testPrivateKey2, expiry };
    await writeWalletState(walletState({ accessKeys: [first, selected] }));
    const request = vi.fn().mockResolvedValue(undefined);

    const result = await updateAccessKeyHandler(
      await readyWallet(undefined, false),
      { accessKey, limit: "250" },
      async () => ({ request }),
    );

    expect(request).toHaveBeenCalledWith({
      method: "wallet_updateAccessKey",
      params: [
        expect.objectContaining({
          accessKeyAddress: testAccessKey2,
          limits: [{ token: usdcToken, limit: toHex(250_000_000n) }],
        }),
      ],
    });
    expect(result.access_key).toBe(testAccessKey2.toLowerCase());
    expect((await loadWalletState()).accessKeys.map((key) => key.limits?.[0]?.limit)).toEqual([
      "100000000#__bigint",
      "250000000#__bigint",
    ]);
  });

  it.each([
    { name: "an expired key", key: { expiry: 1 } },
    { name: "a key without signing material", key: { privateKey: undefined } },
  ])("updates the only stored key by default, even $name", async ({ key: overrides }) => {
    await useTempHome();
    await writeWalletState(
      walletState({ accessKeys: [{ ...walletState().accessKeys[0]!, ...overrides }] }),
    );
    const request = vi.fn().mockResolvedValue(undefined);

    const result = await updateAccessKeyHandler(
      await readyWallet(undefined, false),
      { limit: "0" },
      async () => ({ request }),
    );

    expect(request).toHaveBeenCalledWith({
      method: "wallet_updateAccessKey",
      params: [expect.objectContaining({ accessKeyAddress: testAccessKey })],
    });
    expect(result).toMatchObject({ access_key: testAccessKey.toLowerCase(), limit: "0" });
  });

  it.each([
    {
      name: "more than one stored key, even when only one is usable",
      accessKeys: [
        { ...walletState().accessKeys[0]!, privateKey: undefined },
        { ...walletState().accessKeys[0]!, address: testAccessKey2, privateKey: testPrivateKey2 },
      ],
      message: `More than one access key is configured for the current wallet and network (${testAccessKey.toLowerCase()}, ${testAccessKey2.toLowerCase()}); pass the access key to update.`,
    },
    {
      name: "no stored key",
      accessKeys: [],
      message: "No access key is configured for the current wallet and network.",
    },
  ])("asks for the access key with $name", async ({ accessKeys, message }) => {
    await useTempHome();
    await writeWalletState(walletState({ accessKeys }));
    const createProvider = vi.fn();

    try {
      await updateAccessKeyHandler(
        await readyWallet(undefined, false),
        { limit: "0" },
        createProvider,
      );
      expect.unreachable("expected updateAccessKeyHandler to throw");
    } catch (error) {
      expectUsageError(error, message);
    }
    expect(createProvider).not.toHaveBeenCalled();
  });

  it.each([
    { limit: "-1", token: undefined, decimals: 6 },
    { limit: "not-an-amount", token: undefined, decimals: 6 },
    { limit: "0.0000001", token: undefined, decimals: 6 },
    { limit: "1.5", token: unlistedToken, decimals: 0 },
    { limit: "0.0000000000000000001", token: unlistedToken, decimals: 18 },
  ])(
    "rejects access key limit $limit for a $decimals-decimal token",
    async ({ limit, token, decimals }) => {
      await useTempHome();
      await writeWalletState(walletState());
      mocks.getMetadata.mockResolvedValue({ decimals, symbol: "TOKEN" });
      const createProvider = vi.fn();

      const error = await updateAccessKeyHandler(
        await readyWallet(),
        { limit, token },
        createProvider,
      ).catch((value: unknown) => value);

      expectUsageError(
        error,
        `Invalid limit: expected a non-negative token amount with at most ${decimals} decimals`,
      );
      expect(createProvider).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: "cbBTC", token: "cbBTC", address: cbBtcToken, limit: "0.5", raw: 500_000n },
    { name: "USDC.e", token: "USDC.e", address: usdcToken, limit: "0", raw: 0n },
    {
      name: "an unlisted 18-decimal token",
      token: unlistedToken,
      address: unlistedToken,
      metadata: { decimals: 18, symbol: "WEI" },
      limit: "1.000000000000000001",
      raw: 10n ** 18n + 1n,
    },
    {
      name: "an unlisted 0-decimal token",
      token: unlistedToken,
      address: unlistedToken,
      metadata: { decimals: 0, symbol: "WHOLE" },
      limit: "7",
      raw: 7n,
    },
  ])(
    "sets --limit $limit in the decimals of $name",
    async ({ token, address, metadata, limit, raw }) => {
      await useTempHome();
      await writeWalletState(walletState());
      if (metadata) mocks.getMetadata.mockResolvedValue(metadata);
      const updateAccessKey = vi.fn(async () => undefined);

      const result = await updateAccessKeyHandler(
        await readyWallet(),
        { limit, token },
        async () => ({ request: vi.fn() }),
        updateAccessKey,
      );

      expect(updateAccessKey).toHaveBeenCalledWith(
        expect.objectContaining({ token: address, limit: raw }),
      );
      expect(result).toMatchObject({ token: address, limit });
      expect(mocks.getMetadata.mock.calls.map(([, parameters]) => parameters)).toEqual(
        metadata ? [{ token: address }] : [],
      );
    },
  );

  it.each(tokenInputs)(
    "updates the limit for --token $input on $network",
    async ({ input, network, address }) => {
      await useTempHome();
      const chainId = parseNetwork(network).chainId;
      const key = { ...walletState().accessKeys[0]!, chainId, limits: [] };
      await writeWalletState(walletState({ chainId, accessKeys: [key] }));
      const updateAccessKey = vi.fn(async () => undefined);

      const result = await updateAccessKeyHandler(
        await readyWallet(network),
        { limit: "5", token: input },
        async () => ({ request: vi.fn() }),
        updateAccessKey,
      );

      expect(updateAccessKey).toHaveBeenCalledWith(
        expect.objectContaining({ chainId, token: address, limit: 5_000_000n }),
      );
      expect(result).toMatchObject({ token: address, limit: "5" });
      expect((await loadWalletState()).accessKeys[0]?.limits).toEqual([
        { token: address, limit: "5000000#__bigint" },
      ]);
    },
  );

  it.each([
    ...invalidTokenInputs("token"),
    { input: "not-an-address", network: "mainnet", message: 'Unknown token "not-an-address"' },
  ])("rejects --token $input on $network", async ({ input, network, message }) => {
    await useTempHome();
    const chainId = parseNetwork(network).chainId;
    await writeWalletState(
      walletState({ chainId, accessKeys: [{ ...walletState().accessKeys[0]!, chainId }] }),
    );
    const createProvider = vi.fn();

    const error = await updateAccessKeyHandler(
      await readyWallet(network),
      { limit: "250", token: input },
      createProvider,
    ).catch((value: unknown) => value);

    expectTokenError(error, message);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("rejects an invalid selected access key address", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const createProvider = vi.fn();

    try {
      await updateAccessKeyHandler(
        await readyWallet(),
        { accessKey: "not-an-address", limit: "250" },
        createProvider,
      );
      expect.unreachable("expected updateAccessKeyHandler to throw");
    } catch (error) {
      expectUsageError(error, "Invalid access key address: expected a 0x address");
    }
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("rejects a selected access key outside the active wallet and network", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const createProvider = vi.fn();

    try {
      await updateAccessKeyHandler(
        await readyWallet(),
        { accessKey: testAccessKey2, limit: "250" },
        createProvider,
      );
      expect.unreachable("expected updateAccessKeyHandler to throw");
    } catch (error) {
      expectUsageError(
        error,
        "Selected access key is not configured for the current wallet and network.",
      );
    }
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("requests 30-day access keys and the deposit screen when connecting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T00:00:00Z"));
    const request = vi.fn().mockResolvedValue({ accounts: [] });

    await connect({ request } as never, { name: "mainnet", chainId: 4217 });

    expect(request).toHaveBeenCalledWith({
      method: "wallet_connect",
      params: [
        {
          chainId: "0x1079",
          capabilities: {
            authorizeAccessKey: {
              expiry: Math.floor(Date.now() / 1000) + accessKeyAuthorizationSeconds,
            },
            showDeposit: true,
          },
        },
      ],
    });
  });
});

function identitySession(overrides: Partial<PersistedSessionRecord> = {}): PersistedSessionRecord {
  return {
    accepted_cumulative: 2_000n,
    authorized_signer: testAccessKey,
    chain_id: 4217,
    challenge_echo: "{}",
    channel_id: `0x${"a".repeat(64)}`,
    close_requested_at: 0,
    created_at: 1,
    cumulative_amount: 2_000n,
    deposit: 10_000n,
    escrow_contract: "0x0000000000000000000000000000000000000001",
    grace_ready_at: 901,
    last_used_at: 1,
    network: "tempo",
    origin: "https://example.com",
    payee: testWallet2,
    payer: testWallet,
    request_url: "https://example.com/",
    salt: `0x${"0".repeat(64)}`,
    server_spent: 2_000n,
    session_protocol: "v1",
    state: "active",
    token: usdc,
    ...overrides,
  };
}
