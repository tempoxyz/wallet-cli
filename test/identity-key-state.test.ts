import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, zeroAddress } from "viem";

type Metadata = {
  address: string;
  keyType: "secp256k1";
  expiry: bigint;
  spendPolicy: "limited" | "unlimited";
  isRevoked: boolean;
};
type Client = { chainId: number };

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(async (): Promise<bigint> => 0n),
  fetch: vi.fn(async (_url: URL | string): Promise<Response> => Response.json([])),
  getKey: vi.fn(
    async (_client: Client, _parameters: { account: string; accessKey: string }) =>
      ({}) as Metadata,
  ),
  getRemainingLimit: vi.fn(
    async (_client: Client, _parameters: { account: string; accessKey: string; token: string }) =>
      ({ remaining: 0n, periodEnd: undefined }) as { remaining: bigint; periodEnd: undefined },
  ),
  /** The chain the RPC answers `eth_chainId` with, given the chain its client was built for. */
  getChainId: vi.fn(async (chain: number) => chain),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn((options: { chain: { id: number } }) => ({
      chainId: options.chain.id,
      readContract: mocks.readContract,
      getChainId: () => mocks.getChainId(options.chain.id),
    })),
    http: vi.fn(actual.http),
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
        getMetadata: mocks.getKey,
        getRemainingLimit: mocks.getRemainingLimit,
      },
    },
  };
});

import { currentKeysOutput, currentWhoamiOutput, whoamiHandler } from "../src/commands/identity.js";
import { moderatoToken } from "../src/shared/constants.js";
import { keysOutput } from "../src/schemas/keys.js";
import { whoamiOutput } from "../src/schemas/whoami.js";
import type { WalletState } from "../src/wallet/store.js";
import {
  testAccessKey,
  testAccessKey2,
  testPrivateKey2,
  testWallet,
  testWallet2,
  usdc,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

type AccessKey = WalletState["accessKeys"][number];

const key: AccessKey = { ...walletState().accessKeys[0]!, permissionSemantics: 1 };
const pendingKey: AccessKey = {
  ...key,
  keyAuthorization: {
    address: testAccessKey,
    chainId: 4217n,
    expiry: 4_102_444_800,
    signature: { type: "secp256k1", signature: "0x1234" },
    type: "secp256k1",
  },
};

const published: Metadata = {
  address: testAccessKey,
  keyType: "secp256k1",
  expiry: 0n,
  spendPolicy: "limited",
  isRevoked: false,
};
const missing: Metadata = { ...published, address: zeroAddress, spendPolicy: "unlimited" };
const revoked: Metadata = { ...published, isRevoked: true };

beforeEach(async () => {
  await useTempHome();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getKey.mockResolvedValue(published);
  mocks.getRemainingLimit.mockResolvedValue({ remaining: 40_000_000n, periodEnd: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mocks.getChainId.mockReset();
  mocks.getChainId.mockImplementation(async (chain) => chain);
  mocks.readContract.mockReset();
  mocks.readContract.mockResolvedValue(0n);
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async () => Response.json([]));
  mocks.getKey.mockReset();
  mocks.getRemainingLimit.mockReset();
  vi.mocked(http).mockClear();
});

function whoami(accessKeys: AccessKey[], walletAddress: string | null = testWallet) {
  return currentWhoamiOutput({ walletAddress, chain: 4217, accessKeys });
}

describe("whoami ready", () => {
  it.each([
    { name: "no wallet", wallet: null, key: undefined, ready: false, status: undefined },
    { name: "no key", key: undefined, ready: false, status: undefined },
    { name: "a published key", key, ready: true, status: "ready", published: true },
    {
      name: "a pending key not yet published",
      key: pendingKey,
      chain: missing,
      ready: true,
      status: "pending",
      published: false,
    },
    {
      name: "a pending key the chain already holds",
      key: pendingKey,
      ready: true,
      status: "ready",
      published: true,
    },
    {
      name: "a pending key with an unreadable chain",
      key: pendingKey,
      chain: "fail",
      ready: true,
      status: "pending",
      published: null,
    },
    {
      name: "an expired key",
      key: { ...key, expiry: 1 },
      ready: false,
      status: "expired",
      published: true,
    },
    {
      name: "a key that cannot sign here",
      key: { ...key, privateKey: undefined },
      ready: false,
      status: "unusable",
      published: true,
    },
    {
      name: "a published key with an unreadable balance",
      key,
      balance: "fail",
      ready: false,
      status: "ready",
      published: true,
    },
  ] as const)("is $ready for $name", async (scenario) => {
    if ("chain" in scenario)
      if (scenario.chain === "fail") mocks.getKey.mockRejectedValue(new Error("RPC unavailable"));
      else mocks.getKey.mockResolvedValue(scenario.chain);
    if ("balance" in scenario) mocks.readContract.mockRejectedValue(new Error("RPC unavailable"));

    const output = await whoami(
      scenario.key ? [scenario.key] : [],
      "wallet" in scenario ? scenario.wallet : testWallet,
    );

    expect(whoamiOutput.options[1].parse(output)).toMatchObject({
      ready: scenario.ready,
      key: scenario.key
        ? {
            status: scenario.status,
            published: "published" in scenario ? scenario.published : null,
          }
        : null,
    });
    // `ready` follows the reported key status, so the two never disagree.
    expect(output.ready).toBe(
      output.wallet !== null &&
        output.balance.available !== null &&
        (output.key?.status === "ready" || output.key?.status === "pending"),
    );
  });
});

describe("remaining and spent limits", () => {
  const restricted: AccessKey = {
    ...key,
    limits: [
      { token: usdc, limit: "100000000#__bigint", period: 86_400 },
      { token: moderatoToken, limit: "5000000#__bigint" },
    ],
  };

  it.each([
    {
      name: "a published key",
      remaining: [40_000_000n, 5_000_000n],
      published: true,
      limits: [
        { remaining: "40.000000", spent: null },
        { remaining: "5.000000", spent: null },
      ],
    },
    {
      name: "an unpublished key, whose chain limit reads as zero",
      chain: missing,
      published: false,
      reads: 0,
      limits: [
        { remaining: null, spent: null },
        { remaining: null, spent: null },
      ],
    },
    {
      name: "a revoked key",
      chain: revoked,
      published: false,
      reads: 0,
      limits: [
        { remaining: null, spent: null },
        { remaining: null, spent: null },
      ],
    },
    {
      name: "a key the chain does not limit",
      chain: { ...published, spendPolicy: "unlimited" },
      published: true,
      reads: 0,
      limits: [
        { remaining: null, spent: null },
        { remaining: null, spent: null },
      ],
    },
    {
      name: "an unreadable key",
      chain: "fail",
      published: null,
      reads: 0,
      limits: [
        { remaining: null, spent: null },
        { remaining: null, spent: null },
      ],
    },
    {
      name: "an unreadable remaining limit",
      remaining: ["fail", 1_000_000n],
      published: true,
      limits: [
        { remaining: null, spent: null },
        { remaining: "1.000000", spent: null },
      ],
    },
  ] as const)("reports $name", async (scenario) => {
    if ("chain" in scenario)
      if (scenario.chain === "fail") mocks.getKey.mockRejectedValue(new Error("RPC unavailable"));
      else mocks.getKey.mockResolvedValue(scenario.chain);
    const remaining = "remaining" in scenario ? scenario.remaining : [];
    mocks.getRemainingLimit.mockImplementation(async (_client, { token }) => {
      const value = remaining[token === usdc.toLowerCase() ? 0 : 1];
      if (value === "fail" || value === undefined) throw new Error("RPC unavailable");
      return { remaining: value, periodEnd: undefined };
    });

    const outputs = [
      whoamiOutput.options[1].parse(await whoami([restricted])).key,
      keysOutput.parse(
        await currentKeysOutput({ walletAddress: testWallet, accessKeys: [restricted] }),
      ).keys[0],
    ];

    for (const output of outputs) {
      expect(output).toMatchObject({
        published: scenario.published,
        spending_limits: scenario.limits,
        spending_limit: scenario.limits[0],
      });
    }
    expect(mocks.getRemainingLimit).toHaveBeenCalledTimes(
      "reads" in scenario ? scenario.reads : 2 * outputs.length,
    );
    for (const [, parameters] of mocks.getRemainingLimit.mock.calls)
      expect(parameters).toMatchObject({ account: testWallet, accessKey: testAccessKey });
    // Every read is bounded and never retried.
    for (const [, options] of vi.mocked(http).mock.calls)
      expect(options).toEqual({ timeout: 3_000, retryCount: 0 });
  });
});

describe("stale stored limits", () => {
  // The stored limit is 100 USDC.e; another wallet client may have changed the chain's since.
  const stored: AccessKey = { ...key, limits: [{ token: usdc, limit: "100000000#__bigint" }] };

  it.each([
    { name: "spending from the stored limit", remaining: 60_000_000n, shown: "60.000000" },
    // Lowered from 100 to 50 elsewhere, then 10 spent: 60 would be reported spent.
    { name: "a limit lowered elsewhere, then spent", remaining: 40_000_000n, shown: "40.000000" },
    { name: "a limit raised elsewhere", remaining: 150_000_000n, shown: "150.000000" },
  ])("reports the chain's remaining and no spent for $name", async ({ remaining, shown }) => {
    mocks.getRemainingLimit.mockResolvedValue({ remaining, periodEnd: undefined });

    const { keys } = await currentKeysOutput({ walletAddress: testWallet, accessKeys: [stored] });

    expect(keys[0]).toMatchObject({
      spending_limit: { limit: "100.000000", remaining: shown, spent: null },
      spending_limits: [{ limit: "100.000000", remaining: shown, spent: null }],
    });
  });
});

describe("TEMPO_RPC_URL chain check", () => {
  const testnetKey: AccessKey = {
    ...key,
    address: testAccessKey2,
    privateKey: testPrivateKey2,
    chainId: 42431,
    limits: [{ token: moderatoToken, limit: "1000000#__bigint" }],
  };
  const accessKeys = [key, { ...key, address: testAccessKey2 }, testnetKey];
  const mainnetRead = { published: true, spending_limits: [{ remaining: "40.000000" }] };
  const testnetRead = { published: true, spending_limits: [{ remaining: "40.000000" }] };
  const unread = { published: null, spending_limits: [{ remaining: null, spent: null }] };

  it.each([
    {
      name: "trusts an override on each key's chain",
      override: "http://127.0.0.1:8545",
      serves: (chain: number) => chain,
      checks: [4217, 42431],
      keys: [mainnetRead, mainnetRead, testnetRead],
    },
    {
      name: "drops reads an override serves from another chain",
      override: "http://127.0.0.1:8545",
      serves: () => 4217,
      checks: [4217, 42431],
      keys: [mainnetRead, mainnetRead, unread],
    },
    {
      name: "drops reads when the override does not answer eth_chainId",
      override: "http://127.0.0.1:8545",
      serves: (): number => {
        throw new Error("RPC unavailable");
      },
      checks: [4217, 42431],
      keys: [unread, unread, unread],
    },
    {
      name: "skips the check without an override",
      override: undefined,
      serves: (chain: number) => chain,
      checks: [],
      keys: [mainnetRead, mainnetRead, testnetRead],
    },
  ])("$name", async ({ override, serves, checks, keys }) => {
    vi.stubEnv("TEMPO_RPC_URL", override);
    mocks.getChainId.mockImplementation(async (chain) => serves(chain));
    mocks.getKey.mockImplementation(async (_client, { accessKey }) => ({
      ...published,
      address: accessKey,
    }));

    const output = await currentKeysOutput({ walletAddress: testWallet, accessKeys });

    expect(output.keys).toMatchObject(keys);
    // One eth_chainId per distinct chain, bounded and without retries.
    expect(mocks.getChainId.mock.calls.map(([chain]) => chain)).toEqual(checks);
    for (const [, options] of vi.mocked(http).mock.calls)
      expect(options).toEqual({ timeout: 3_000, retryCount: 0 });
  });

  it("checks whoami's key chain once", async () => {
    mocks.getChainId.mockResolvedValue(42431);

    const output = await whoami([key]);

    expect(output).toMatchObject({ ready: true, key: { status: "ready", published: null } });
    expect(mocks.getChainId.mock.calls).toEqual([[4217]]);
    expect(mocks.getRemainingLimit).not.toHaveBeenCalled();
  });
});

describe("deprecated spending_limit", () => {
  it.each([
    {
      name: "a restricted key",
      key: { ...key, limits: [{ token: usdc, limit: "2500000#__bigint", period: 3_600 }] },
      mode: "restricted",
    },
    {
      name: "a legacy key with a limit",
      key: {
        ...key,
        permissionSemantics: undefined,
        limits: [{ token: usdc, limit: "2500000#__bigint" }],
      },
      mode: "unknown",
    },
    { name: "an unrestricted key", key: { ...key, limits: undefined }, mode: "unrestricted" },
  ])("mirrors spending_limits[0] for $name", async ({ key, mode }) => {
    const { keys } = await currentKeysOutput({ walletAddress: testWallet, accessKeys: [key] });
    const output = keys[0]!;
    const first = output.spending_limits[0];

    expect(output.spending_limit).toEqual({
      mode,
      unlimited: mode === "unknown" ? null : mode === "unrestricted",
      limit: first?.limit ?? null,
      raw_limit: first?.raw_limit ?? null,
      period_seconds: first?.period_seconds ?? null,
      remaining: first?.remaining ?? null,
      spent: first?.spent ?? null,
    });
  });

  it("reports no limit as zero for a key that cannot spend", async () => {
    const { keys } = await currentKeysOutput({
      walletAddress: testWallet,
      accessKeys: [{ ...key, limits: [] }],
    });

    expect(keys[0]).toMatchObject({
      spending_limit: { mode: "none", limit: "0.000000", raw_limit: "0", remaining: null },
      spending_limits: [],
    });
  });
});

it("reports every address in lowercase", async () => {
  const mixedCaseKey: AccessKey = {
    ...key,
    address: testAccessKey2,
    privateKey: testPrivateKey2,
    limits: [{ token: usdc, limit: "1000000#__bigint" }],
    scopes: [{ address: usdc, recipients: [testWallet2] }],
  };
  mocks.getKey.mockResolvedValue({ ...published, address: testAccessKey2 });
  mocks.fetch.mockImplementation(async (url) =>
    String(url).includes("/api/assets")
      ? Response.json([
          { address: usdc, balance: "1000000", decimals: 6, symbol: "USDC.e", verified: true },
        ])
      : Response.json({ credits: { rawAmount: "1" } }),
  );
  await writeWalletState(walletState({ accessKeys: [mixedCaseKey] }));

  const outputs = [
    await whoami([mixedCaseKey]),
    await currentKeysOutput({ walletAddress: testWallet, accessKeys: [mixedCaseKey] }),
    await whoamiHandler({ mach: true }),
    await whoamiHandler({ credits: true }),
  ];

  const shown = addresses(outputs);
  expect(shown.length).toBeGreaterThan(10);
  expect(shown).toEqual(shown.map((address) => address.toLowerCase()));
});

describe("keys list on chain", () => {
  const testnetKey: AccessKey = {
    ...key,
    address: testAccessKey2,
    privateKey: testPrivateKey2,
    chainId: 42431,
    limits: [{ token: moderatoToken, limit: "1000000#__bigint" }],
  };
  const otherWalletKey: AccessKey = { ...key, access: testWallet2 };

  it("reads each key on its own network", async () => {
    mocks.getKey.mockImplementation(async (_client, { accessKey }) => ({
      ...published,
      address: accessKey,
    }));

    const { keys } = await currentKeysOutput({
      walletAddress: testWallet,
      accessKeys: [key, testnetKey],
    });

    expect(keys.map(({ chain_id, published }) => ({ chain_id, published }))).toEqual([
      { chain_id: 4217, published: true },
      { chain_id: 42431, published: true },
    ]);
    expect(
      mocks.getKey.mock.calls.map(([client, { accessKey }]) => [client.chainId, accessKey]),
    ).toEqual([
      [4217, testAccessKey],
      [42431, testAccessKey2],
    ]);
    expect(
      mocks.getRemainingLimit.mock.calls.map(([client, { token }]) => [client.chainId, token]),
    ).toEqual([
      [4217, usdc.toLowerCase()],
      [42431, moderatoToken],
    ]);
  });

  it.each([
    { name: "another wallet's key", accessKeys: [otherWalletKey], reads: [] },
    {
      name: "another wallet's key next to the active wallet's",
      accessKeys: [key, otherWalletKey],
      reads: [testWallet],
    },
  ])("reads nothing on chain for $name", async ({ accessKeys, reads }) => {
    const { keys } = await currentKeysOutput({ walletAddress: testWallet, accessKeys });

    expect(keys.at(-1)).toMatchObject({
      wallet_address: testWallet2.toLowerCase(),
      published: null,
      spending_limits: [{ remaining: null, spent: null }],
    });
    expect(mocks.getKey.mock.calls.map(([, { account }]) => account)).toEqual(reads);
    expect(mocks.getRemainingLimit.mock.calls.map(([, { account }]) => account)).toEqual(reads);
  });

  it("reads nothing on chain without a logged-in wallet", async () => {
    const { keys } = await currentKeysOutput({ walletAddress: null, accessKeys: [key] });

    expect(keys[0]).toMatchObject({ published: null });
    expect(mocks.getKey).not.toHaveBeenCalled();
    expect(mocks.getRemainingLimit).not.toHaveBeenCalled();
  });
});

/** Every 0x address in `value`, as the output spells it. */
function addresses(value: unknown): string[] {
  if (typeof value === "string") return /^0x[0-9a-f]{40}$/i.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(addresses);
  if (value && typeof value === "object") return Object.values(value).flatMap(addresses);
  return [];
}
