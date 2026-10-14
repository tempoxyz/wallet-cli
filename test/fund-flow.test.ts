import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readContract: vi.fn(), open: vi.fn(), state: vi.fn() }));
vi.mock("../src/shared/network.js", async (original) => ({
  ...(await original<typeof import("../src/shared/network.js")>()),
  createTempoPublicClient: () => ({ readContract: mocks.readContract }),
}));
vi.mock("../src/shared/process.js", async (original) => ({
  ...(await original<typeof import("../src/shared/process.js")>()),
  openExternal: mocks.open,
}));
vi.mock("../src/wallet/store.js", async (original) => ({
  ...(await original<typeof import("../src/wallet/store.js")>()),
  loadWalletState: mocks.state,
}));
import { fundUrl, runFundingFlow } from "../src/commands/fund.js";
import { machToken } from "../src/shared/mach.js";

const wallet = "0x1111111111111111111111111111111111111111";
const usdc = "0x20c000000000000000000000b9537d11c60e8b50";
const pathUsd = "0x20c0000000000000000000000000000000000000";
const machUrl = fundUrl("mach", { address: wallet, chainId: 4217, amount: "5" });
const statusCheck = (baseline: string) => ({
  argv: [
    "tempo",
    "wallet",
    "fund",
    "--mach",
    "--address",
    wallet,
    "--amount",
    "5",
    "--baseline",
    baseline,
    "--no-wait",
    "--network",
    "mainnet",
  ],
  command: `tempo wallet fund --mach --address ${wallet} --amount 5 --baseline ${baseline} --no-wait --network mainnet`,
  until: '.status == "success"',
  poll_interval_seconds: 10,
});

/** Each balance read returns the next value, then repeats the last one. */
function balances(...values: bigint[]) {
  mocks.readContract.mockImplementation(async () =>
    values.length > 1 ? values.shift() : values[0],
  );
}

beforeEach(() => {
  mocks.state.mockResolvedValue({
    accounts: [{ address: wallet }],
    activeAccount: 0,
    chainId: 4217,
    accessKeys: [],
  });
  mocks.readContract.mockReset();
  mocks.open.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.TEMPO_WALLET_FUND_POLL_MS = "1";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TEMPO_WALLET_FUND_POLL_MS;
});

describe("funding completion", () => {
  it.each([
    {
      case: "the requested amount arrives in parts",
      amount: "5",
      reads: [10_000_000n, 12_000_000n, 15_000_000n],
      received: "5",
    },
    {
      case: "an unrelated small deposit precedes the requested amount",
      amount: "5",
      reads: [10_000_000n, 10_010_000n, 15_010_000n],
      received: "5.01",
    },
    {
      case: "any increase arrives without a requested amount",
      amount: undefined,
      reads: [10_000_000n, 10_010_000n],
      received: "0.01",
    },
  ])("succeeds when $case", async ({ amount, reads, received }) => {
    const count = reads.length;
    balances(...reads);
    const result = await runFundingFlow({ action: "fund", amount, noBrowser: true });
    expect(result).toMatchObject({ status: "success", token: usdc, symbol: "USDC.e", received });
    expect(result).not.toHaveProperty("_next");
    expect(mocks.readContract).toHaveBeenCalledTimes(count);
  });

  it("does not count an unrelated small deposit toward the requested amount", async () => {
    balances(10_000_000n, 10_010_000n);
    const result = await runFundingFlow({
      action: "mach",
      amount: "5",
      noBrowser: true,
      timeout: 0.05,
    });
    expect(result).toMatchObject({
      status: "timeout",
      balance: "10.01",
      raw_balance: "10010000",
      received: "0.01",
      raw_received: "10000",
      _next: statusCheck("10000000"),
    });
  });

  it("prints the link, reads the baseline, then opens the browser", async () => {
    balances(0n, 1n);
    await runFundingFlow({ action: "mach" });
    const link = vi.mocked(console.error).mock.invocationCallOrder[0]!;
    const [baseline] = mocks.readContract.mock.invocationCallOrder;
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toBe(
      `Open this link on your device: ${fundUrl("mach", { address: wallet, chainId: 4217 })}`,
    );
    expect(link).toBeLessThan(baseline!);
    expect(baseline).toBeLessThan(mocks.open.mock.invocationCallOrder[0]!);
  });
});

describe("watched asset", () => {
  it.each([
    { action: "fund", network: "mainnet", token: usdc, symbol: "USDC.e" },
    { action: "fund", network: "testnet", token: pathUsd, symbol: "PathUSD" },
    { action: "crypto", network: "mainnet", token: usdc, symbol: "USDC.e" },
    { action: "crypto", network: "testnet", token: pathUsd, symbol: "PathUSD" },
    { action: "mach", network: "mainnet", token: machToken(4217), symbol: "MACH" },
  ] as const)(
    "watches $symbol for $action on $network",
    async ({ action, network, token, symbol }) => {
      balances(0n, 1n);
      const result = await runFundingFlow({ action, network, noBrowser: true });
      expect(result).toMatchObject({ status: "success", token, symbol, received: "0.000001" });
      expect(mocks.readContract).toHaveBeenLastCalledWith(
        expect.objectContaining({ address: token, args: [wallet] }),
      );
    },
  );

  it.each([{ noWait: false }, { noWait: true }])(
    "hands off a referral claim without watching any balance (%o)",
    async ({ noWait }) => {
      const result = await runFundingFlow({ action: "claim", code: "REF123", noWait });
      expect(result).toMatchObject({
        status: "pending",
        action: "claim",
        token: null,
        received: null,
        instruction: expect.stringContaining("cannot observe referral payouts"),
      });
      expect(result).not.toHaveProperty("_next");
      expect(mocks.readContract).not.toHaveBeenCalled();
      expect(mocks.open).toHaveBeenCalledWith(result.url);
    },
  );
});

describe("starting balance failure", () => {
  it.each([
    { mode: "wait", noWait: false, expected: { message: "RPC down" }, printed: true },
    {
      mode: "no-wait",
      noWait: true,
      expected: {
        status: "pending",
        url: machUrl,
        balance: null,
        received: null,
        instruction: expect.stringContaining("could not be read"),
      },
      printed: false,
    },
  ])("still shows the link ($mode)", async ({ noWait, expected, printed }) => {
    mocks.readContract.mockRejectedValue(new Error("RPC down"));
    const outcome = await runFundingFlow({
      action: "mach",
      amount: "5",
      noBrowser: true,
      noWait,
    }).catch((error: unknown) => error);
    expect(outcome).toMatchObject(expected);
    expect(outcome).not.toHaveProperty("_next");
    expect(vi.mocked(console.error).mock.calls.flat()).toEqual(
      printed ? expect.arrayContaining([`Open this link on your device: ${machUrl}`]) : [],
    );
  });
});

describe("no-wait status check", () => {
  it("returns the link with a status check from the recorded baseline", async () => {
    balances(10_000_000n);
    const result = await runFundingFlow({ action: "mach", amount: "5", noWait: true });
    expect(result).toMatchObject({
      status: "pending",
      url: machUrl,
      balance: "10",
      received: "0",
      _next: statusCheck("10000000"),
    });
    expect(mocks.open).toHaveBeenCalledWith(machUrl);
  });

  it.each([
    { case: "nothing has arrived", current: 10_000_000n, status: "pending", received: "0" },
    { case: "only a small deposit", current: 10_010_000n, status: "pending", received: "0.01" },
    { case: "the balance fell", current: 9_000_000n, status: "pending", received: "0" },
    { case: "the requested amount", current: 15_000_000n, status: "success", received: "5" },
  ])("reports $status after $case", async ({ current, status, received }) => {
    balances(current);
    const result = await runFundingFlow({
      action: "mach",
      address: wallet,
      amount: "5",
      baseline: "10000000",
      noWait: true,
    });
    expect(result).toMatchObject({ status, url: machUrl, received });
    if (status === "pending") expect(result).toMatchObject({ _next: statusCheck("10000000") });
    else expect(result).not.toHaveProperty("_next");
    expect(mocks.readContract).toHaveBeenCalledTimes(1);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it.each(["-1", "1.5", "abc", "0x10", "01", (2n ** 256n).toString()])(
    "rejects baseline %s",
    async (baseline) => {
      await expect(
        runFundingFlow({ action: "mach", baseline, noWait: true }),
      ).rejects.toMatchObject({ code: "E_USAGE", message: expect.stringContaining("--baseline") });
      expect(mocks.readContract).not.toHaveBeenCalled();
    },
  );

  it("rejects a baseline for a referral claim", async () => {
    await expect(
      runFundingFlow({ action: "claim", code: "REF123", baseline: "1", noWait: true }),
    ).rejects.toMatchObject({ code: "E_USAGE", message: expect.stringContaining("--claim") });
  });
});

describe("funding timeout", () => {
  it.each([
    {
      case: "a fresh wait",
      baseline: undefined,
      reads: [10_000_000n, 11_000_000n],
      recorded: "10000000",
      received: "1",
      opened: 1,
    },
    {
      case: "a resumed wait",
      baseline: "9000000",
      reads: [11_000_000n],
      recorded: "9000000",
      received: "2",
      opened: 0,
    },
  ])(
    "returns the link and a status check when $case times out",
    async ({ baseline, reads, recorded, received, opened }) => {
      balances(...reads);
      const result = await runFundingFlow({ action: "mach", amount: "5", baseline, timeout: 0.05 });
      expect(result).toMatchObject({
        status: "timeout",
        url: machUrl,
        received,
        instruction: expect.stringContaining("Timed out waiting for funding"),
        _next: statusCheck(recorded),
      });
      expect(mocks.open).toHaveBeenCalledTimes(opened);
    },
  );
});
