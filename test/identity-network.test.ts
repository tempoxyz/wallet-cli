import { afterEach, expect, it, vi } from "vitest";
import { createPublicClient, http } from "viem";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(async () => 0n),
  request: vi.fn(
    async (_input: {
      method: string;
      params: readonly [{ chainId?: string }];
    }): Promise<{
      accounts: { address: string }[];
    }> => ({ accounts: [] }),
  ),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract: mocks.readContract })),
    http: vi.fn(actual.http),
  };
});

vi.mock("../src/provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider.js")>()),
  createProvider: vi.fn(() => ({ request: mocks.request })),
}));

import { loginHandler, refreshHandler, whoamiHandler } from "../src/commands/identity.js";
import { loadWalletState, saveWalletState } from "../src/wallet/store.js";
import { moderatoToken } from "../src/shared/constants.js";
import {
  testAccessKey2,
  testPrivateKey2,
  testWallet,
  testWallet2,
  useTempHome,
  usdc,
  walletState,
} from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mocks.request.mockReset();
  mocks.readContract.mockClear();
  vi.mocked(createPublicClient).mockClear();
  vi.mocked(http).mockClear();
});

it.each([
  { name: "login", handler: loginHandler },
  { name: "refresh", handler: refreshHandler },
])("$name connects on Moderato when the persisted chain is mainnet", async ({ handler }) => {
  await useTempHome();
  await saveWalletState(walletState());
  mocks.request.mockImplementation(async ({ params }) => {
    const state = await loadWalletState();
    const selectedChain = params[0].chainId ? Number(params[0].chainId) : state.chainId!;
    await saveWalletState({
      ...state,
      chainId: selectedChain,
      accessKeys: [
        ...state.accessKeys,
        { ...walletState().accessKeys[0]!, address: testAccessKey2, chainId: selectedChain },
      ],
    });
    return { accounts: [{ address: testWallet }] };
  });

  expect(await handler({ network: "testnet" })).toMatchObject({ chainId: 42431 });
  expect(mocks.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "wallet_connect",
      params: [expect.objectContaining({ chainId: "0xa5bf" })],
    }),
  );
  const state = await loadWalletState();
  expect(state.chainId).toBe(42431);
  expect(state.accessKeys.map((key) => key.chainId)).toEqual([4217, 42431]);
});

it.each([
  {
    storedChain: 4217,
    network: "testnet",
    selectedChain: 42431,
    token: moderatoToken,
    rpc: "https://rpc.moderato.tempo.xyz",
  },
  {
    storedChain: 42431,
    network: "mainnet",
    selectedChain: 4217,
    token: usdc,
    rpc: "https://rpc.mainnet.tempo.xyz",
  },
])("whoami selects $network independently of stored chain $storedChain", async (scenario) => {
  await useTempHome();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );
  await saveWalletState(
    walletState({
      chainId: scenario.storedChain,
      accessKeys: [
        walletState().accessKeys[0]!,
        {
          ...walletState().accessKeys[0]!,
          address: testAccessKey2,
          privateKey: testPrivateKey2,
          chainId: 42431,
          limits: [{ token: moderatoToken, limit: "100000000#__bigint" }],
        },
      ],
    }),
  );

  expect(await whoamiHandler({ network: scenario.network })).toMatchObject({
    ready: true,
    wallet: testWallet.toLowerCase(),
    key: { chain_id: scenario.selectedChain },
  });
  expect(mocks.readContract).toHaveBeenCalledWith(
    expect.objectContaining({ address: scenario.token }),
  );
  expect(createPublicClient).toHaveBeenCalledWith(
    expect.objectContaining({ chain: expect.objectContaining({ id: scenario.selectedChain }) }),
  );
  expect(http).toHaveBeenCalledWith(scenario.rpc, expect.objectContaining({ retryCount: 0 }));
  expect((await loadWalletState()).chainId).toBe(scenario.storedChain);
});

it("whoami honors TEMPO_WALLET_NETWORK when no flag is supplied", async () => {
  await useTempHome();
  vi.stubEnv("TEMPO_WALLET_NETWORK", "testnet");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );
  await saveWalletState(
    walletState({
      accessKeys: [{ ...walletState().accessKeys[0]!, chainId: 42431, limits: undefined }],
    }),
  );

  expect(await whoamiHandler({})).toMatchObject({ ready: true, key: { chain_id: 42431 } });
});

it.each([
  { name: "expired", overrides: { expiry: 1 } },
  { name: "missing signing material", overrides: { privateKey: undefined } },
  { name: "another wallet", overrides: { access: testWallet2 } },
])("login does not reuse a cached $name key", async ({ overrides }) => {
  await useTempHome();
  await saveWalletState(
    walletState({ accessKeys: [{ ...walletState().accessKeys[0]!, ...overrides }] }),
  );
  mocks.request.mockResolvedValue({ accounts: [{ address: testWallet }] });

  expect(await loginHandler({ network: "mainnet" })).toMatchObject({ chainId: 4217 });
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("login reuses a usable cached key without starting authorization", async () => {
  await useTempHome();
  await saveWalletState(walletState());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );

  expect(await loginHandler({ network: "mainnet" })).toMatchObject({ ready: true });
  expect(mocks.request).not.toHaveBeenCalled();
});
