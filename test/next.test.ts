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
  createPublicClient: vi.fn(() => ({ readContract: mocks.readContract })),
}));

vi.mock("../src/provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider.js")>()),
  createProvider: vi.fn(() => ({ request: mocks.request })),
}));

import { loginHandler, revokeHandler, updateAccessKeyHandler } from "../src/commands/identity.js";
import { closeSessions } from "../src/commands/sessions.js";
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
  testAccessKey,
  testAccessKey2,
  testWallet,
  testWallet2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

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
    name: "swap --dry-run reruns the swap with --yes",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return swapTokens(
        {
          args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
          options: { network: option, "dry-run": true, "slippage-bps": 50 },
        },
        swapDependencies(),
      );
    },
    argv: ["wallet", "swap", "10", usdcToken, moderatoToken, "--slippage-bps", "50", "--yes"],
  },
  {
    name: "swap --dry-run keeps exact-out, slippage, and fee token",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return swapTokens(
        {
          args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
          options: {
            network: option,
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
        {
          args: { amount: "10", tokenIn: moderatoToken, tokenOut: usdcToken },
          options: { network: option, "dry-run": true, "slippage-bps": 50 },
        },
        swapDependencies(),
      );
    },
    argv: ["wallet", "keys", "update", "--token", moderatoToken, "--limit", "10"],
  },
  {
    name: "swap --dry-run without a usable key points at login",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain, { accessKeys: [] }));
      return swapTokens(
        {
          args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
          options: { network: option, "dry-run": true, "slippage-bps": 50 },
        },
        swapDependencies(),
      );
    },
    argv: ["wallet", "login"],
  },
  {
    name: "transfer --dry-run reruns without --dry-run",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return transferTokens({
        args: { amount: "1.5", token: usdcToken, to: recipient },
        options: { network: option, "dry-run": true },
      });
    },
    argv: ["wallet", "transfer", "1.5", usdcToken, recipient],
  },
  {
    name: "transfer --dry-run keeps fee token and address",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return transferTokens({
        args: { amount: "1.5", token: usdcToken, to: recipient },
        options: {
          network: option,
          "dry-run": true,
          "fee-token": moderatoToken,
          address: testWallet,
        },
      });
    },
    argv: [
      "wallet",
      "transfer",
      "1.5",
      usdcToken,
      recipient,
      "--fee-token",
      moderatoToken,
      "--address",
      testWallet,
    ],
  },
  {
    name: "MACH transfer --dry-run reruns with the challenge inline",
    run: async ({ option, chain }) =>
      transferMach({
        options: {
          network: option,
          "dry-run": true,
          "amount-cents": 2,
          "mpp-challenge": `WWW-Authenticate: ${machChallenge(chain)}`,
          "mpp-client-id": "agent 1",
        },
      }),
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
    name: "revoke --dry-run reruns without --dry-run",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return revokeHandler({ accessKey: testAccessKey2 }, { network: option, "dry-run": true });
    },
    argv: ["wallet", "revoke", testAccessKey2.toLowerCase()],
  },
  {
    name: "keys update confirms the new limit with keys list",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      return updateAccessKeyHandler({ network: option, limit: "250" }, () => ({
        request: vi.fn(),
      }));
    },
    argv: ["wallet", "keys", "list"],
  },
  {
    name: "fresh login confirms readiness with whoami",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain, { accessKeys: [] }));
      mocks.request.mockResolvedValue({ accounts: [{ address: testWallet }] });
      return loginHandler({ network: option });
    },
    argv: ["wallet", "whoami"],
  },
  {
    name: "a pending session close polls the channel until withdrawal",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      await saveSession(channelId, chain);
      mockEscrow();
      return closeSessions({ network: option, target: channelId });
    },
    argv: ["wallet", "sessions", "close", channelId],
    until: ".pending == 0",
    poll_interval_seconds: 800,
  },
  {
    name: "several pending session closes finalize after the last grace period",
    run: async ({ option, chain }) => {
      await writeWalletState(stateFor(chain));
      await saveSession(channelId, chain);
      await saveSession(otherChannelId, chain);
      mockEscrow();
      return closeSessions({ network: option, target: origin });
    },
    argv: ["wallet", "sessions", "close", "--finalize"],
    poll_interval_seconds: 800,
  },
];

describe.each([
  { name: "the default network", option: undefined, env: undefined, network: [] },
  { name: "--network", option: "testnet", env: undefined, network: ["--network", "testnet"] },
  {
    name: "TEMPO_WALLET_NETWORK",
    option: undefined,
    env: "testnet",
    network: ["--network", "testnet"],
  },
])("continuations on $name", ({ option, env, network }) => {
  it.each(continuations)("$name", async ({ run, argv, until, poll_interval_seconds }) => {
    vi.useFakeTimers({ now: now * 1000, toFake: ["Date"] });
    vi.stubEnv("TEMPO_WALLET_NETWORK", env);
    vi.stubEnv("TEMPO_MAX_SPEND", undefined);
    await useTempHome();
    const chain = (option ?? env) ? 42431 : 4217;

    const result = (await run({ option, chain })) as {
      instruction?: unknown;
      _next?: { argv: string[]; command: string };
    };

    const expected = [
      "tempo",
      ...argv.map((arg) => (arg === "<challenge>" ? machChallenge(chain) : arg)),
      ...network,
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

  const result = await closeSessions({ target: channelId });

  expect(result).toMatchObject({
    pending: 1,
    instruction: expect.stringContaining("after 2026-10-13T12:13:20Z (in 800s)"),
    _next: { command: `tempo wallet sessions close ${channelId}` },
  });
});

it.each([
  {
    name: "a submitted swap",
    run: async () => {
      await writeWalletState(stateFor(4217));
      return swapTokens(
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
        false,
        0n,
        testWallet,
        testWallet2,
        usdcToken,
        testAccessKey,
        0n,
        0n,
      ]);
      return closeSessions({ target: channelId });
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

async function saveSession(id: string, chain: number) {
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
