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
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn((options: { chain: { id: number } }) => ({
      chainId: options.chain.id,
      readContract: mocks.readContract,
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
import { keysOutput, whoamiOutput } from "../src/schemas.js";
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
        { remaining: "40.000000", spent: "60.000000" },
        { remaining: "5.000000", spent: "0.000000" },
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
        { remaining: "1.000000", spent: "4.000000" },
      ],
    },
    {
      name: "a chain limit above the stored one",
      remaining: [150_000_000n, 5_000_000n],
      published: true,
      limits: [
        { remaining: "150.000000", spent: null },
        { remaining: "5.000000", spent: "0.000000" },
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
