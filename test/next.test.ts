import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Challenge } from "mppx";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  request: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  // A zero block height leaves orphaned-channel discovery with nothing to scan.
  createPublicClient: vi.fn(() => ({
    getBlockNumber: async () => 0n,
    readContract: mocks.readContract,
  })),
}));

vi.mock("../src/provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider.js")>()),
  createProvider: vi.fn(async () => ({ request: mocks.request })),
}));

import { updateAccessKeyHandler } from "../src/commands/keys.js";
import { revokeHandler } from "../src/commands/revoke.js";
import { runFundingFlow } from "../src/commands/fund.js";
import { loginHandler } from "../src/commands/login.js";
import { closeSessions, dryRunCloseSessions } from "../src/commands/sessions/close.js";
import { swapTokens } from "../src/commands/swap.js";
import { transferMach, transferTokens } from "../src/commands/transfer.js";
import { upsertSessionRecord } from "../src/payment/session-store.js";
import {
  mainnetEscrow,
  moderatoEscrow,
  moderatoToken,
  usdcToken,
} from "../src/shared/constants.js";
import { shellQuote } from "../src/shared/next.js";
import {
  readyWallet,
  runContext,
  testAccessKey,
  testWallet,
  testWallet2,
  unlistedToken,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";
import { deviceCodeHost } from "./device-code-host.js";

const execFileAsync = promisify(execFile);
const recipient = "0x1111111111111111111111111111111111111111";
const channelId = `0x${"a".repeat(64)}`;
const otherChannelId = `0x${"b".repeat(64)}`;
const origin = "https://service.example";
const now = Date.parse("2026-10-13T12:00:00Z") / 1000;
const closeRequestedAt = { [channelId]: now - 100, [otherChannelId]: now - 300 };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.readContract.mockReset();
  mocks.request.mockReset();
});

describe("shellQuote", () => {
  it.each([
    ["tempo", "tempo"],
    ["--max-spend", "--max-spend"],
    ["0.02", "0.02"],
    [usdcToken, usdcToken],
    ["", "''"],
    ["agent 1", "'agent 1'"],
    ["it's", "'it'\\''s'"],
    ["$HOME", "'$HOME'"],
    ["a;b", "'a;b'"],
    ["*", "'*'"],
    ["~", "'~'"],
    ["line\nbreak", "'line\nbreak'"],
    ['Payment id="x", realm="y"', `'Payment id="x", realm="y"'`],
    ["https://x.test/a?b=c&d", "'https://x.test/a?b=c&d'"],
  ])("quotes %j as %s", async (value, quoted) => {
    expect(shellQuote(value)).toBe(quoted);
    expect(await shellWords(quoted)).toEqual([value]);
  });
});

type Network = { option: string | undefined; chain: number };

const continuations: {
  name: string;
  run: (network: Network) => Promise<unknown>;
  argv: string[];
  until?: string;
  poll_interval_seconds?: number;
}[] = [
  {
    name: "swap --dry-run reruns the swap with the reviewed minimum output and --yes",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return swapTokens(
        await readyWallet(option),
        {
          args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
          options: { "dry-run": true, "slippage-bps": 50 },
        },
        swapDependencies(),
      );
    },
    argv: [
      "wallet",
      "swap",
      "10",
      usdcToken,
      moderatoToken,
      "--min-amount-out",
      "9.751",
      "--slippage-bps",
      "50",
      "--yes",
    ],
  },
  {
    name: "swap --dry-run keeps exact-out with the reviewed maximum input, slippage, and fee token",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return swapTokens(
        await readyWallet(option),
        {
          args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
          options: {
            "dry-run": true,
            "exact-out": true,
            "fee-token": moderatoToken,
            "slippage-bps": 25,
          },
        },
        swapDependencies(),
      );
    },
    argv: [
      "wallet",
      "swap",
      "10",
      usdcToken,
      moderatoToken,
      "--exact-out",
      "--max-amount-in",
      "10.12525",
      "--slippage-bps",
      "25",
      "--fee-token",
      moderatoToken,
      "--yes",
    ],
  },
  {
    name: "swap --dry-run points a limited key at keys update",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return swapTokens(
        await readyWallet(option),
        {
          args: { amount: "10", tokenIn: moderatoToken, tokenOut: usdcToken },
          options: { "dry-run": true, "slippage-bps": 50 },
        },
        swapDependencies(),
      );
    },
    argv: ["wallet", "keys", "update", testAccessKey, "--token", moderatoToken, "--limit", "10"],
  },
  {
    name: "transfer --dry-run reruns with --yes",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return transferTokens(
        await readyWallet(option),
        { args: { amount: "1.5", token: "pathUSD", to: recipient }, options: { "dry-run": true } },
        transferDependencies(),
      );
    },
    // Without --fee-token, the reviewed fee token (here the transferred one) is pinned.
    argv: [
      "wallet",
      "transfer",
      "1.5",
      moderatoToken,
      recipient,
      "--fee-token",
      moderatoToken,
      "--yes",
    ],
  },
  {
    name: "transfer --dry-run keeps fee token and address",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return transferTokens(
        await readyWallet(option),
        {
          args: { amount: "1.5", token: moderatoToken, to: recipient },
          options: { "dry-run": true, "fee-token": usdcToken, address: testWallet },
        },
        transferDependencies(),
      );
    },
    argv: [
      "wallet",
      "transfer",
      "1.5",
      moderatoToken,
      recipient,
      "--fee-token",
      usdcToken,
      "--address",
      testWallet,
      "--yes",
    ],
  },
  {
    name: "MACH transfer --dry-run reruns with the challenge inline",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return transferMach({
        options: {
          network: option,
          "dry-run": true,
          "amount-cents": 2,
          "mpp-challenge": `WWW-Authenticate: ${machChallenge(chain)}`,
          "mpp-client-id": "agent 1",
        },
      });
    },
    argv: [
      "wallet",
      "transfer",
      "--mach",
      "--max-spend",
      "0.02",
      "--mpp-challenge",
      "<challenge>",
      "--mpp-client-id",
      "agent 1",
    ],
  },
  {
    name: "revoke --dry-run reruns with --yes",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return revokeHandler(
        await readyWallet(option),
        { accessKey: testAccessKey },
        { "dry-run": true },
        runContext(),
      );
    },
    argv: ["wallet", "revoke", testAccessKey.toLowerCase(), "--yes"],
  },
  {
    name: "keys update confirms the new limit with keys list",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      // pathUSD is listed on both networks, so its decimals need no RPC read.
      return updateAccessKeyHandler(
        await readyWallet(option),
        { limit: "250", token: moderatoToken },
        async () => ({ request: vi.fn() }),
      );
    },
    argv: ["wallet", "keys", "list"],
  },
  {
    name: "a pending agent login waits for approval with login status",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain, { accessKeys: [] }));
      vi.stubGlobal("fetch", deviceCodeHost(() => "approve", { interval: 5 }).fetch);
      return loginHandler({ network: option, browser: false, wait: false });
    },
    argv: ["wallet", "login", "status", "--interval", "5"],
    until: '.status != "pending"',
    poll_interval_seconds: 5,
  },
  {
    name: "a pending funding waits for its funds with fund status",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      mocks.readContract.mockResolvedValue(0n);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      return runFundingFlow({ action: "fund", network: option, noBrowser: true });
    },
    argv: ["wallet", "fund", "status", "--interval", "5"],
    until: '.status != "pending"',
    poll_interval_seconds: 5,
  },
  {
    name: "fresh login confirms readiness with whoami",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain, { accessKeys: [] }));
      vi.stubGlobal("fetch", deviceCodeHost(() => "approve").fetch);
      return loginHandler({ network: option, browser: false, wait: true });
    },
    argv: ["wallet", "whoami"],
  },
  {
    name: "a pending session close polls the channel until withdrawal",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      await saveSession(channelId, chain);
      mockEscrow();
      return closeSessions(
        await readyWallet(option),
        { target: channelId, yes: true },
        runContext(),
      );
    },
    // The close was confirmed, so the withdrawal that completes it does not ask again.
    argv: ["wallet", "sessions", "close", channelId, "--yes"],
    until: ".pending == 0 and .failed == 0",
    poll_interval_seconds: 800,
  },
  {
    name: "a session close dry run continues with the confirmed close",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      await saveSession(channelId, chain);
      return dryRunCloseSessions(await readyWallet(option), { target: channelId });
    },
    argv: ["wallet", "sessions", "close", channelId, "--yes"],
  },
];

// The wallet is logged in on `chain`; every continuation names the network the command resolved.
describe.each([
  { name: "the default network", option: undefined, env: undefined, chain: 4217 },
  { name: "the logged-in chain", option: undefined, env: undefined, chain: 42431 },
  { name: "--network", option: "tempo-moderato", env: undefined, chain: 42431 },
  { name: "TEMPO_WALLET_NETWORK", option: undefined, env: "moderato", chain: 42431 },
])("continuations on $name", ({ option, env, chain }) => {
  it.each(continuations)("$name", async ({ run, argv, until, poll_interval_seconds }) => {
    vi.useFakeTimers({ now: now * 1000, toFake: ["Date"] });
    vi.stubEnv("TEMPO_WALLET_NETWORK", env);
    vi.stubEnv("TEMPO_MAX_SPEND", undefined);
    await useTempHome();

    const result = (await run({ option, chain })) as {
      instruction?: unknown;
      _next?: { argv: string[]; command: string };
    };

    const expected = [
      "tempo",
      ...argv.map((arg) => (arg === "<challenge>" ? machChallenge(chain) : arg)),
      "--network",
      chain === 42431 ? "testnet" : "mainnet",
    ];
    expect(result.instruction).toEqual(expect.any(String));
    expect(result._next).toEqual({
      argv: expected,
      command: expect.any(String),
      ...(until ? { until } : {}),
      ...(poll_interval_seconds ? { poll_interval_seconds } : {}),
    });
    expect(await shellWords(result._next!.command)).toEqual(expected);
  });
});

it("states when a pending session close becomes withdrawable", async () => {
  vi.useFakeTimers({ now: now * 1000, toFake: ["Date"] });
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  await useTempHome();
  await writeWalletState(stateFor(4217));
  await saveSession(channelId, 4217);
  mockEscrow();

  const result = await closeSessions(
    await readyWallet(),
    { target: channelId, yes: true },
    runContext(),
  );

  expect(result).toMatchObject({
    pending: 1,
    instruction: expect.stringContaining("after 2026-10-13T12:13:20Z (in 800s)"),
    _next: { command: `tempo wallet sessions close ${channelId} --yes --network mainnet` },
  });
});

it.each([
  {
    name: "a submitted swap",
    run: async () => {
      await writeWalletState(stateFor(4217));
      return swapTokens(
        await readyWallet(),
        {
          args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
          options: { "slippage-bps": 50, yes: true },
        },
        swapDependencies(),
      );
    },
  },
  {
    name: "a MACH dry-run without a spending cap",
    run: async () =>
      transferMach({ options: { "dry-run": true, "mpp-challenge": machChallenge(4217) } }),
  },
  {
    name: "a session close that completed",
    run: async () => {
      await writeWalletState(stateFor(4217));
      await saveSession(channelId, 4217);
      mocks.readContract.mockResolvedValue([
        true,
        0n,
        testWallet,
        testWallet2,
        usdcToken,
        testAccessKey,
        10_000n,
        2_000n,
      ]);
      return closeSessions(await readyWallet(), { target: channelId, yes: true }, runContext());
    },
  },
])("omits a continuation from $name", async ({ run }) => {
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  vi.stubEnv("TEMPO_MAX_SPEND", undefined);
  await useTempHome();

  const result = await run();

  expect(result).not.toHaveProperty("instruction");
  expect(result).not.toHaveProperty("_next");
});

it.each([
  { name: "an origin", options: { target: origin }, session: {} },
  { name: "--all", options: { all: true }, session: {} },
  { name: "--orphaned", options: { orphaned: true }, session: { state: "orphaned" } },
  {
    name: "--finalize",
    options: { finalize: true },
    session: { state: "closing", close_requested_at: now - 100, grace_ready_at: now - 1 },
  },
])(
  "names each channel when several $name closes are pending, since a rerun may select others",
  async ({ options, session }) => {
    vi.useFakeTimers({ now: now * 1000, toFake: ["Date"] });
    vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
    await useTempHome();
    await writeWalletState(stateFor(4217));
    await saveSession(channelId, 4217, session);
    await saveSession(otherChannelId, 4217, session);
    mockEscrow();

    const result = await closeSessions(
      await readyWallet(),
      { ...options, yes: true },
      runContext(),
    );

    expect(result).toMatchObject({ pending: 2 });
    for (const id of [channelId, otherChannelId])
      expect(result).toHaveProperty(
        "instruction",
        expect.stringContaining(`'tempo wallet sessions close ${id} --yes --network mainnet'`),
      );
    expect(result).not.toHaveProperty("_next");
  },
);

it("points a limited key at keys update in a non-6-decimal input token's units", async () => {
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  await useTempHome();
  await writeWalletState(stateFor(4217));
  const dependencies = swapDependencies();
  // An unlisted token reports its decimals on chain; 10.15 TWO quoted, 10.21 TWO with slippage.
  dependencies.getMetadata.mockImplementation(async () => ({ decimals: 2, symbol: "TWO" }));
  dependencies.getBuyQuote.mockResolvedValue(1_015n);

  const result = await swapTokens(
    await readyWallet(),
    {
      args: { amount: "10", tokenIn: unlistedToken, tokenOut: usdcToken },
      options: { "dry-run": true, "exact-out": true, "slippage-bps": 50 },
    },
    dependencies,
  );

  expect(result).toMatchObject({
    requires_access_key_update: true,
    max_amount_in: "10.21",
    _next: {
      argv: [
        "tempo",
        "wallet",
        "keys",
        "update",
        testAccessKey,
        "--token",
        unlistedToken,
        "--limit",
        "10.21",
        "--network",
        "mainnet",
      ],
    },
  });
});

it("keeps the selected network on each per-channel close command", async () => {
  vi.useFakeTimers({ now: now * 1000, toFake: ["Date"] });
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  await useTempHome();
  await writeWalletState(stateFor(42431));
  await saveSession(channelId, 42431);
  await saveSession(otherChannelId, 42431);
  mockEscrow();

  const result = await closeSessions(
    await readyWallet("testnet"),
    { target: origin, yes: true },
    runContext(),
  );

  for (const id of [channelId, otherChannelId])
    expect(result).toHaveProperty(
      "instruction",
      expect.stringContaining(`'tempo wallet sessions close ${id} --yes --network testnet'`),
    );
});

/** Splits a command into words the way a POSIX shell does. */
async function shellWords(command: string) {
  const { stdout } = await execFileAsync("/bin/sh", ["-c", `printf '%s\\0' ${command}`]);
  return stdout.split("\0").slice(0, -1);
}

function stateFor(chain: number, overrides: Parameters<typeof walletState>[0] = {}) {
  const key = walletState().accessKeys[0]!;
  return walletState({ chainId: chain, accessKeys: [{ ...key, chainId: chain }], ...overrides });
}

function swapDependencies() {
  return {
    getBalance: vi.fn(async () => 100_000_000n),
    getMetadata: vi.fn(async (token: string) => ({
      decimals: 6,
      symbol: token === usdcToken ? "USDC.e" : "pathUSD",
    })),
    getBuyQuote: vi.fn(async () => 10_100_000n),
    getSellQuote: vi.fn(async () => 9_800_000n),
    submit: vi.fn(async () => `0x${"ab".repeat(32)}`),
  };
}

function transferDependencies() {
  return {
    getBalance: vi.fn(async () => 100_000_000n),
    estimateFee: vi.fn(async () => 175n),
    getUserFeeToken: vi.fn(async () => null),
    submit: vi.fn(async () => `0x${"ab".repeat(32)}`),
  };
}

function machChallenge(chain: number) {
  return Challenge.serialize(
    Challenge.from({
      id: "mach-offer",
      realm: "local",
      method: "tempo",
      intent: "charge",
      request: {
        amount: "15000",
        currency: chain === 42431 ? moderatoToken : usdcToken,
        recipient,
        methodDetails: { chainId: chain, machineTokenEnabled: true },
      },
    }),
  );
}

async function saveSession(
  id: string,
  chain: number,
  overrides: Partial<Parameters<typeof upsertSessionRecord>[0]> = {},
) {
  await upsertSessionRecord({
    accepted_cumulative: 2_000n,
    authorized_signer: testAccessKey,
    chain_id: chain,
    challenge_echo: "{}",
    channel_id: id,
    close_requested_at: 0,
    created_at: 1,
    cumulative_amount: 2_000n,
    deposit: 10_000n,
    escrow_contract: chain === 42431 ? moderatoEscrow : mainnetEscrow,
    grace_ready_at: 0,
    last_used_at: 1,
    network: chain === 42431 ? "tempo-moderato" : "tempo",
    origin,
    payee: testWallet2,
    payer: testWallet,
    request_url: `${origin}/session`,
    salt: `0x${"0".repeat(64)}`,
    server_spent: 2_000n,
    session_protocol: "v1",
    state: "active",
    token: usdcToken,
    ...overrides,
  });
}

/** Escrow reads for channels whose close was already requested within a 900s grace period. */
function mockEscrow() {
  mocks.readContract.mockImplementation(
    async ({ functionName, args }: { functionName: string; args: [string] }) => {
      if (functionName === "CLOSE_GRACE_PERIOD") return 900n;
      const requestedAt = closeRequestedAt[args[0]] ?? 0;
      return [
        false,
        BigInt(requestedAt),
        testWallet,
        testWallet2,
        usdcToken,
        testAccessKey,
        10_000n,
        2_000n,
      ];
    },
  );
}
