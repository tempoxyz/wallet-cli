import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPublicClient, http } from "viem";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(async (_call: { address: string; args: readonly unknown[] }) => 0n),
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

import {
  debugHandler,
  keysHandler,
  loginHandler,
  refreshHandler,
  revokeHandler,
  updateAccessKeyHandler,
  whoamiHandler,
} from "../src/commands/identity.js";
import { listSessions } from "../src/commands/sessions.js";
import { swapTokens } from "../src/commands/swap.js";
import { transferCredits, transferTokens } from "../src/commands/transfer.js";
import { loadWalletState, saveWalletState, type WalletState } from "../src/wallet/store.js";
import { moderatoToken } from "../src/shared/constants.js";
import {
  readyWallet,
  testAccessKey,
  testAccessKey2,
  testPrivateKey2,
  testWallet,
  testWallet2,
  useTempHome,
  usdc,
  walletState,
  writeRawWalletStore,
} from "./helpers.js";

const mainnet = { chain_id: 4217, network: "tempo" };
const testnet = { chain_id: 42431, network: "tempo-moderato" };
const testnetKey = {
  ...walletState().accessKeys[0]!,
  address: testAccessKey2,
  privateKey: testPrivateKey2,
  chainId: 42431,
  limits: [{ token: moderatoToken, limit: "100000000#__bigint" }],
};

beforeEach(() => {
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  vi.stubEnv("TEMPO_RPC_URL", undefined);
  // Keep deprecation warnings out of the test output.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

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

it.each([
  { store: "a mainnet chain", write: () => saveWalletState(walletState()) },
  { store: "no chain", write: () => writeStoreWithoutChain([walletState().accessKeys[0]!]) },
])("login reuses a usable cached key on a store with $store", async ({ write }) => {
  await useTempHome();
  await write();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );

  expect(await loginHandler({ network: "mainnet" })).toMatchObject({ ready: true });
  expect(mocks.request).not.toHaveBeenCalled();
});

it("whoami stays on the network chosen at login", async () => {
  await useTempHome();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );
  mocks.request.mockImplementation(async ({ params }) => {
    await saveWalletState(
      walletState({ chainId: Number(params[0].chainId), accessKeys: [testnetKey] }),
    );
    return { accounts: [{ address: testWallet }] };
  });

  await loginHandler({ network: "testnet" });

  expect(await whoamiHandler({})).toMatchObject({
    ready: true,
    ...testnet,
    key: { address: testAccessKey2.toLowerCase(), ...testnet },
  });
});

const loggedOutCommands = [
  { command: "whoami", run: (network?: string) => whoamiHandler({ network }) },
  { command: "debug", run: (network?: string) => debugHandler({ network }) },
  { command: "sessions list", run: (network?: string) => listSessions({ network }) },
];

const networkCommands = [
  ...loggedOutCommands,
  {
    command: "transfer --dry-run",
    run: async (network?: string) =>
      transferTokens(await readyWallet(network), {
        args: { amount: "1", token: usdc, to: testWallet2 },
        options: { "dry-run": true },
      }),
  },
  {
    command: "transfer --credits --dry-run",
    run: (network?: string) =>
      transferCredits({
        options: { network, "amount-cents": 100, to: testWallet2, "dry-run": true },
      }),
  },
  {
    command: "swap --dry-run",
    run: async (network?: string) =>
      swapTokens(
        await readyWallet(network),
        {
          args: { amount: "1", tokenIn: usdc, tokenOut: moderatoToken },
          options: { "dry-run": true, "slippage-bps": 50 },
        },
        {
          getBalance: async () => 100_000_000n,
          getMetadata: async () => ({ decimals: 6, symbol: "TOKEN" }),
          getSellQuote: async () => 1_000_000n,
        },
      ),
  },
];

const precedence = [
  {
    source: "the logged-in chain",
    storedChain: 42431,
    env: undefined,
    flag: undefined,
    expected: testnet,
  },
  {
    source: "TEMPO_WALLET_NETWORK over the logged-in chain",
    storedChain: 42431,
    env: "mainnet",
    flag: undefined,
    expected: mainnet,
  },
  {
    source: "--network over TEMPO_WALLET_NETWORK",
    storedChain: 4217,
    env: "mainnet",
    flag: "testnet",
    expected: testnet,
  },
  {
    source: "--network over the logged-in chain",
    storedChain: 42431,
    env: undefined,
    flag: "tempo",
    expected: mainnet,
  },
];

it.each(
  precedence.flatMap((scenario) => networkCommands.map((command) => ({ ...scenario, ...command }))),
)(
  "$command selects $expected.network from $source",
  async ({ storedChain, env, flag, expected, run }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_WALLET_NETWORK", env);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );
    await saveWalletState(
      walletState({ chainId: storedChain, accessKeys: [walletState().accessKeys[0]!, testnetKey] }),
    );

    expect(await run(flag)).toMatchObject(expected);
  },
);

it.each(loggedOutCommands)("$command defaults to mainnet when logged out", async ({ run }) => {
  await useTempHome();

  expect(await run()).toMatchObject(mainnet);
});

const keyManagementCommands = [
  {
    command: "revoke --dry-run",
    run: async (network?: string) =>
      revokeHandler(await readyWallet(network), { accessKey: testAccessKey2 }, { "dry-run": true }),
  },
  {
    command: "keys update",
    run: async (network?: string) =>
      updateAccessKeyHandler(
        await readyWallet(network),
        { limit: "1" },
        () => ({ request: vi.fn() }),
        vi.fn(),
      ),
  },
];

it.each(
  [
    { source: "the logged-in chain", env: undefined, flag: undefined },
    { source: "a matching --network", env: "mainnet", flag: "testnet" },
  ].flatMap((scenario) => keyManagementCommands.map((command) => ({ ...scenario, ...command }))),
)("$command targets $source", async ({ env, flag, run }) => {
  await useTempHome();
  vi.stubEnv("TEMPO_WALLET_NETWORK", env);
  await saveWalletState(walletState({ chainId: 42431, accessKeys: [testnetKey] }));

  expect(await run(flag)).toMatchObject(testnet);
});

it.each(
  [
    { source: "--network", env: undefined, flag: "mainnet" },
    { source: "TEMPO_WALLET_NETWORK", env: "mainnet", flag: undefined },
  ].flatMap((scenario) => keyManagementCommands.map((command) => ({ ...scenario, ...command }))),
)("$command rejects another chain from $source", async ({ env, flag, run }) => {
  await useTempHome();
  vi.stubEnv("TEMPO_WALLET_NETWORK", env);
  // A usable mainnet key leaves only the logged-in chain to reject the selection.
  await saveWalletState(
    walletState({ chainId: 42431, accessKeys: [testnetKey, walletState().accessKeys[0]!] }),
  );

  await expect(run(flag)).rejects.toMatchObject({
    code: "E_USAGE",
    message: "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
  });
});

const chainlessSelections = [
  { selection: "no selection", env: undefined, flag: undefined, accepted: true },
  { selection: "--network mainnet", env: undefined, flag: "mainnet", accepted: true },
  { selection: "TEMPO_WALLET_NETWORK=mainnet", env: "mainnet", flag: undefined, accepted: true },
  { selection: "--network testnet", env: undefined, flag: "testnet", accepted: false },
  { selection: "TEMPO_WALLET_NETWORK=testnet", env: "testnet", flag: undefined, accepted: false },
].flatMap((scenario) => keyManagementCommands.map((command) => ({ ...scenario, ...command })));

it.each(chainlessSelections.filter(({ accepted }) => accepted))(
  "$command treats a store without a chain as mainnet with $selection",
  async ({ env, flag, run }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_WALLET_NETWORK", env);
    await writeStoreWithoutChain([walletState().accessKeys[0]!]);

    expect(await run(flag)).toMatchObject(mainnet);
  },
);

it.each(chainlessSelections.filter(({ accepted }) => !accepted))(
  "$command rejects $selection on a store without a chain",
  async ({ env, flag, run }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_WALLET_NETWORK", env);
    await writeStoreWithoutChain([walletState().accessKeys[0]!, testnetKey]);

    await expect(run(flag)).rejects.toMatchObject({
      code: "E_USAGE",
      message: "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
    });
  },
);

it("keys list labels each key from its own record and prices only the active wallet's keys", async () => {
  await useTempHome();
  const otherWalletKey = { ...testnetKey, address: "0x3333333333333333333333333333333333333333" };
  await saveWalletState(
    walletState({
      chainId: 4217,
      accessKeys: [
        walletState().accessKeys[0]!,
        testnetKey,
        { ...otherWalletKey, access: testWallet2 },
      ],
    }),
  );
  mocks.readContract.mockResolvedValueOnce(1_000_000n).mockResolvedValueOnce(2_000_000n);

  const result = await keysHandler();

  expect(result).toMatchObject({
    total: 3,
    keys: [
      {
        address: testAccessKey.toLowerCase(),
        ...mainnet,
        wallet_address: testWallet.toLowerCase(),
        token: usdc.toLowerCase(),
        balance: "1",
      },
      {
        address: testAccessKey2.toLowerCase(),
        ...testnet,
        wallet_address: testWallet.toLowerCase(),
        token: moderatoToken,
        balance: "2",
      },
      {
        address: otherWalletKey.address,
        ...testnet,
        wallet_address: testWallet2.toLowerCase(),
        token: moderatoToken,
        balance: null,
      },
    ],
  });
  // Another stored wallet's key is listed without disclosing that wallet to an RPC endpoint.
  expect(result.keys[2]).not.toHaveProperty("balance_error");
  expect(vi.mocked(createPublicClient).mock.calls.map(([options]) => options.chain?.id)).toEqual([
    4217, 42431,
  ]);
  expect(vi.mocked(http).mock.calls.map(([url]) => url)).toEqual([
    "https://rpc.mainnet.tempo.xyz",
    "https://rpc.moderato.tempo.xyz",
  ]);
  expect(mocks.readContract.mock.calls.map(([call]) => [call.address, call.args])).toEqual([
    [usdc, [testWallet]],
    [moderatoToken, [testWallet]],
  ]);
});

it.each([
  { name: "with no logged-in wallet", accounts: [] },
  { name: "for another wallet", accounts: [{ address: testWallet2 }] },
])("keys list queries no balances $name", async ({ accounts }) => {
  await useTempHome();
  await saveWalletState(walletState({ accounts }));

  const result = await keysHandler();

  expect(result.keys).toMatchObject([{ wallet_address: testWallet.toLowerCase(), balance: null }]);
  expect(result.keys[0]).not.toHaveProperty("balance_error");
  expect(mocks.readContract).not.toHaveBeenCalled();
});

it("keys list caches balances per chain and token", async () => {
  await useTempHome();
  const key = walletState().accessKeys[0]!;
  await saveWalletState(
    walletState({
      accessKeys: [key, { ...key, address: testAccessKey2 }, { ...key, chainId: 42431 }],
    }),
  );

  await keysHandler();

  expect(mocks.readContract.mock.calls.map(([call]) => call.args)).toEqual([
    [testWallet],
    [testWallet],
  ]);
  expect(vi.mocked(createPublicClient).mock.calls.map(([options]) => options.chain?.id)).toEqual([
    4217, 42431,
  ]);
});

it.each([
  {
    name: "lists every network without a selection",
    env: undefined,
    flag: undefined,
    chains: [4217, 42431],
  },
  { name: "filters by --network", env: undefined, flag: "testnet", chains: [42431] },
  { name: "filters by TEMPO_WALLET_NETWORK", env: "mainnet", flag: undefined, chains: [4217] },
  {
    name: "prefers --network over TEMPO_WALLET_NETWORK",
    env: "mainnet",
    flag: "moderato",
    chains: [42431],
  },
])("keys list $name", async ({ env, flag, chains }) => {
  await useTempHome();
  vi.stubEnv("TEMPO_WALLET_NETWORK", env);
  await saveWalletState(
    walletState({ chainId: 42431, accessKeys: [walletState().accessKeys[0]!, testnetKey] }),
  );

  const result = await keysHandler({ network: flag });
  expect(result.keys.map((key) => key.chain_id)).toEqual(chains);
  expect(result.total).toBe(chains.length);
});

/** A store with an active account but without the optional `chainId`. */
function writeStoreWithoutChain(accessKeys: WalletState["accessKeys"]) {
  return writeRawWalletStore(
    JSON.stringify({
      "tempo-cli.store": {
        state: { accounts: [{ address: testWallet }], accessKeys, activeAccount: 0 },
        version: 0,
      },
    }),
  );
}
