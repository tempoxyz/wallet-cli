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
import { fundStatusHandler, fundUrl, runFundingFlow } from "../src/commands/fund.js";
import { logoutHandler } from "../src/commands/logout.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { appUrl } from "../src/shared/network.js";
import { machToken } from "../src/shared/mach.js";
import {
  loadPendingFund,
  parsePendingFund,
  savePendingFund,
  type PendingFund,
} from "../src/wallet/store.js";
import { ousdToken, runContext, useTempHome } from "./helpers.js";

const wallet = "0x1111111111111111111111111111111111111111";
const other = { address: "0x3333333333333333333333333333333333333333" };
const tokens = {
  MACH: machToken(4217),
  OUSD: ousdToken,
  "USDC.e": usdcToken,
  pathUSD: moderatoToken,
};
type TokenSymbol = keyof typeof tokens;
const baseline = 3_000_000n;
const url = (query: string) => `${new URL("/agent", appUrl)}?${query}`;

let stderr: string[];

beforeEach(async () => {
  await useTempHome();
  mocks.state.mockResolvedValue({
    accounts: [{ address: wallet }],
    activeAccount: 0,
    chainId: 4217,
    accessKeys: [],
  });
  mocks.readContract.mockReset();
  mocks.open.mockClear();
  stderr = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => void stderr.push(line));
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
  vi.stubEnv("TEMPO_WALLET_FUND_POLL_MS", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Answers each balance read with `baseline`, plus the token's amount in `arrived`. */
function balances(arrived: Partial<Record<TokenSymbol, bigint>> = {}) {
  mocks.readContract.mockImplementation(async ({ address }: { address: string }) => {
    const symbol = (Object.keys(tokens) as TokenSymbol[]).find(
      (key) => tokens[key].toLowerCase() === address.toLowerCase(),
    );
    return baseline + (symbol ? (arrived[symbol] ?? 0n) : 0n);
  });
}

function savedFunding(overrides: Partial<PendingFund> = {}) {
  return parsePendingFund({
    network: "mainnet",
    action: "fund",
    wallet,
    activeWallet: false,
    url: url(`action=fund&address=${wallet}&chainId=4217`),
    amount: null,
    assets: [{ token: ousdToken, symbol: "OUSD", baseline: "0", minimum: "1" }],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  });
}

describe("funding success", () => {
  it.each<{
    name: string;
    action: "fund" | "mach" | "crypto" | "claim";
    network?: string;
    amount?: string;
    arrived: Partial<Record<TokenSymbol, bigint>>;
    success: TokenSymbol | null;
  }>([
    {
      name: "MACH checkout minted the full amount",
      action: "mach",
      amount: "10",
      arrived: { MACH: 10_000_000n },
      success: "MACH",
    },
    {
      name: "MACH one raw unit short of the amount",
      action: "mach",
      amount: "10",
      arrived: { MACH: 9_999_999n },
      success: null,
    },
    {
      name: "an unrelated raw unit of MACH",
      action: "mach",
      amount: "10",
      arrived: { MACH: 1n },
      success: null,
    },
    {
      name: "MACH without an amount below the $5 checkout minimum",
      action: "mach",
      arrived: { MACH: 4_999_999n },
      success: null,
    },
    {
      name: "MACH without an amount at the $5 checkout minimum",
      action: "mach",
      arrived: { MACH: 5_000_000n },
      success: "MACH",
    },
    {
      name: "a USDC.e deposit for MACH funding",
      action: "mach",
      amount: "10",
      arrived: { "USDC.e": 10_000_000n },
      success: null,
    },
    {
      name: "a card purchase settled in OUSD net of fees",
      action: "fund",
      amount: "10",
      arrived: { OUSD: 9_500_000n },
      success: "OUSD",
    },
    {
      name: "a MoonPay purchase settled in USDC.e",
      action: "fund",
      amount: "10",
      arrived: { "USDC.e": 9_800_000n },
      success: "USDC.e",
    },
    {
      name: "a card purchase below 95% of the amount",
      action: "fund",
      amount: "10",
      arrived: { OUSD: 9_499_999n },
      success: null,
    },
    {
      name: "an unrelated raw unit of OUSD",
      action: "fund",
      amount: "10",
      arrived: { OUSD: 1n },
      success: null,
    },
    {
      name: "MACH for general funding",
      action: "fund",
      amount: "10",
      arrived: { MACH: 10_000_000n },
      success: null,
    },
    {
      name: "a dust OUSD transfer without an amount",
      action: "fund",
      arrived: { OUSD: 999_999n },
      success: null,
    },
    {
      name: "a dollar of OUSD without an amount",
      action: "fund",
      arrived: { OUSD: 1_000_000n },
      success: "OUSD",
    },
    {
      name: "a dust USDC.e transfer for a referral claim",
      action: "claim",
      arrived: { "USDC.e": 1n },
      success: null,
    },
    {
      name: "a bridged deposit settled in OUSD",
      action: "crypto",
      amount: "25",
      arrived: { OUSD: 25_000_000n },
      success: "OUSD",
    },
    {
      name: "a referral claim paid in USDC.e",
      action: "claim",
      arrived: { "USDC.e": 2_000_000n },
      success: "USDC.e",
    },
    {
      name: "OUSD for a referral claim",
      action: "claim",
      arrived: { OUSD: 2_000_000n },
      success: null,
    },
    {
      name: "the testnet faucet paying pathUSD",
      action: "fund",
      network: "testnet",
      amount: "10",
      arrived: { pathUSD: 1_000_000_000n },
      success: "pathUSD",
    },
  ])("$name: $success", async ({ action, network, amount, arrived, success }) => {
    balances();
    const handoff = await runFundingFlow({ action, network, amount, code: "REF123" });
    expect(handoff).toMatchObject({ status: "pending", _next: expect.any(Object) });

    balances(arrived);
    const result = await fundStatusHandler({ maxAttempts: 1 });

    const name = network === "testnet" ? "testnet" : "mainnet";
    if (success === null) {
      expect(result).toMatchObject({
        code: "E_POLL_TIMEOUT",
        retryable: true,
        cta: {
          commands: [{ command: `tempo wallet fund status --max-attempts 1 --network ${name}` }],
        },
      });
      expect(await loadPendingFund()).toBeDefined();
      return;
    }
    const raw = baseline + arrived[success]!;
    expect(result).toMatchObject({
      status: "success",
      action,
      wallet,
      token: tokens[success],
      symbol: success,
      amount: amount ?? null,
      raw_balance: raw.toString(),
    });
    expect(await loadPendingFund()).toBeUndefined();
  });
});

describe("the funding link comes first", () => {
  const link = url(`action=fund&intent=mach&address=${wallet}&chainId=4217`);

  it("returns the link without a pending funding when the balance read fails", async () => {
    mocks.readContract.mockRejectedValue(new Error("RPC down"));
    const result = await runFundingFlow({ action: "mach" });

    expect(result).toMatchObject({
      status: "pending",
      url: link,
      balance: null,
      instruction: expect.stringContaining(link),
    });
    expect(result).not.toHaveProperty("_next");
    expect(stderr[0]).toBe(`Open this link on your device: ${link}`);
    expect(mocks.open).toHaveBeenCalledWith(link);
    expect(await loadPendingFund()).toBeUndefined();
  });

  it.each([
    {
      name: "its balance read fails",
      run: () => {
        mocks.readContract.mockRejectedValue(new Error("RPC down"));
        return runFundingFlow({ action: "fund", noBrowser: true });
      },
    },
    {
      name: "it has no wallet to read",
      run: () => {
        mocks.state.mockResolvedValue({ accounts: [], accessKeys: [] });
        return runFundingFlow({ action: "claim", code: "REF123", noBrowser: true });
      },
    },
  ])("forgets the earlier pending funding when a new one $name", async ({ run }) => {
    await savePendingFund(savedFunding());

    expect(await run()).toMatchObject({ status: "pending" });
    expect(await loadPendingFund()).toBeUndefined();
    expect(await fundStatusHandler({ network: "mainnet" })).toMatchObject({ code: "E_USAGE" });
  });

  it.each([
    { name: "succeeds", read: () => Promise.resolve(baseline) },
    { name: "fails", read: () => Promise.reject(new Error("RPC down")) },
  ])(
    "prints the link before the balance read and opens it after the read $name",
    async ({ read }) => {
      const order: string[] = [];
      vi.mocked(console.error).mockImplementation((line: string) => void order.push(line));
      mocks.readContract.mockImplementation(() => (order.push("read"), read()));
      mocks.open.mockImplementation(() => void order.push("open"));

      await runFundingFlow({ action: "mach" });

      expect(order.slice(0, 3)).toEqual([`Open this link on your device: ${link}`, "read", "open"]);
    },
  );

  it("names the --address recipient when its starting balance cannot be read", async () => {
    mocks.readContract.mockRejectedValue(new Error("RPC down"));
    const recipient = "0x2222222222222222222222222222222222222222";
    const result = await runFundingFlow({ action: "mach", address: recipient, noBrowser: true });

    expect(result).toMatchObject({
      status: "pending",
      instruction: expect.stringContaining(`then check the balance of ${recipient}.`),
    });
    expect(stderr.join("\n")).not.toContain("whoami");
  });
});

describe("fund status", () => {
  it.each([
    { name: "nothing is pending", saved: undefined, network: "testnet" },
    { name: "the funding is on another network", saved: savedFunding(), network: "testnet" },
  ])("reports E_USAGE naming fund when $name", async ({ saved, network }) => {
    if (saved) await savePendingFund(saved);
    expect(await fundStatusHandler({ network })).toEqual({
      code: "E_USAGE",
      message: `No funding is pending on testnet. Run 'tempo wallet fund --network testnet' to start one.`,
      exitCode: 2,
      retryable: false,
      cta: { commands: [{ command: "tempo wallet fund --network testnet" }] },
    });
  });

  it.each([
    { name: "the logged-in wallet's funding", address: undefined, saved: false },
    { name: "an --address funding", address: wallet, saved: true },
  ])("after a logout during its balance read, saves $name: $saved", async ({ address, saved }) => {
    const loggedIn = await mocks.state();
    mocks.state.mockResolvedValueOnce(loggedIn).mockResolvedValue({ accounts: [], accessKeys: [] });
    balances();
    const result = runFundingFlow({ action: "fund", address, noBrowser: true });

    if (saved) await expect(result).resolves.toMatchObject({ _next: expect.any(Object) });
    else await expect(result).rejects.toMatchObject({ code: "E_USAGE" });
    expect(Boolean(await loadPendingFund())).toBe(saved);
  });

  it.each([
    { name: "another wallet logged in", address: undefined, accounts: [other], resumes: false },
    { name: "the wallet logged out", address: undefined, accounts: [], resumes: false },
    {
      name: "another wallet logged in, for --address",
      address: wallet,
      accounts: [other],
      resumes: true,
    },
  ])(
    "after $name, fund status resumes the funding: $resumes",
    async ({ address, accounts, resumes }) => {
      balances();
      await runFundingFlow({ action: "fund", address, noBrowser: true });
      mocks.state.mockResolvedValue({ accounts, activeAccount: 0, chainId: 4217, accessKeys: [] });
      balances({ OUSD: 1_000_000n });

      const result = await fundStatusHandler({ network: "mainnet" });

      expect(result).toMatchObject(resumes ? { status: "success", wallet } : { code: "E_USAGE" });
      expect(await loadPendingFund()).toBeUndefined();
    },
  );

  it.each([
    {
      name: "of every network cancels the logged-in wallet's funding",
      address: undefined,
      network: undefined,
      result: { code: "E_USAGE" },
    },
    {
      name: "of the funding's network cancels the logged-in wallet's funding",
      address: undefined,
      network: "mainnet",
      result: { code: "E_USAGE" },
    },
    {
      name: "of another network keeps the logged-in wallet's funding",
      address: undefined,
      network: "testnet",
      result: { status: "success" },
    },
    {
      name: "keeps an --address funding",
      address: wallet,
      network: undefined,
      result: { status: "success" },
    },
  ])("logout $name", async ({ address, network, result }) => {
    balances();
    await runFundingFlow({ action: "fund", address, noBrowser: true });
    expect(await loadPendingFund()).toBeDefined();

    await logoutHandler({ network, yes: true }, runContext());
    balances({ OUSD: 1_000_000n });

    expect(await fundStatusHandler({ network: "mainnet" })).toMatchObject(result);
  });

  it.each([2_147_484, Infinity])("rejects an --interval of %s seconds", async (interval) => {
    await savePendingFund(savedFunding());

    await expect(fundStatusHandler({ interval })).rejects.toMatchObject({
      code: "E_USAGE",
      message: "--interval must be a finite non-negative duration",
    });
    expect(mocks.readContract).not.toHaveBeenCalled();
  });

  it("checks at each interval until the funds arrive", async () => {
    await savePendingFund(savedFunding());
    mocks.readContract
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(1n);

    expect(await fundStatusHandler({ maxAttempts: 3 })).toMatchObject({
      status: "success",
      raw_balance: "1",
    });
    expect(mocks.readContract).toHaveBeenCalledTimes(3);
    expect(await loadPendingFund()).toBeUndefined();
  });

  it.each([
    {
      name: "out of attempts",
      read: () => Promise.resolve(0n),
      options: { interval: 1, maxAttempts: 2 },
      error: {
        code: "E_POLL_TIMEOUT",
        retryable: true,
        message: expect.stringContaining(`Funding has not arrived yet. Continue at ${url("")}`),
        cta: {
          commands: [
            {
              command: "tempo wallet fund status --interval 1 --max-attempts 2 --network mainnet",
            },
          ],
        },
      },
    },
    {
      name: "a failed balance read",
      read: () => Promise.reject(new Error("RPC down")),
      options: {},
      error: {
        code: "E_NETWORK",
        retryable: true,
        cta: { commands: [{ command: "tempo wallet fund status --network mainnet" }] },
      },
    },
    {
      name: "a cancelled wait",
      read: () => Promise.resolve(0n),
      options: { signal: AbortSignal.abort() },
      error: {
        code: "E_POLL_TIMEOUT",
        retryable: true,
        message: expect.stringContaining("Funding wait cancelled."),
        cta: { commands: [{ command: "tempo wallet fund status --network mainnet" }] },
      },
    },
  ])("keeps the funding after $name", async ({ read, options, error }) => {
    const saved = savedFunding();
    await savePendingFund(saved);
    mocks.readContract.mockImplementation(read);

    expect(await fundStatusHandler(options)).toMatchObject(error);
    expect(await loadPendingFund()).toEqual(saved);
  });

  it.each([
    {
      name: "the logged-in wallet",
      activeWallet: true,
      check: "the balance with 'tempo wallet whoami'",
      restart: "tempo wallet fund --mach --network mainnet",
    },
    {
      name: "an --address recipient",
      activeWallet: false,
      check: `the balance of ${wallet}`,
      restart: `tempo wallet fund --mach --address ${wallet} --network mainnet`,
    },
  ])(
    "ends an expired funding for $name and names how to check and restart it",
    async ({ activeWallet, check, restart }) => {
      await savePendingFund(
        savedFunding({ action: "mach", activeWallet, expiresAt: 1_700_000_000 }),
      );
      mocks.readContract.mockResolvedValue(0n);

      expect(await fundStatusHandler({})).toEqual({
        code: "E_POLL_TIMEOUT",
        message: `No funds arrived before the funding expired at 2023-11-14T22:13:20Z. Check ${check}, or run '${restart}' to start a new funding.`,
        exitCode: 3,
        retryable: false,
        cta: { commands: [{ command: restart }] },
      });
      expect(await loadPendingFund()).toBeUndefined();
    },
  );

  it.each([
    { action: "fund", amount: "10", activeWallet: true, flags: "--amount 10" },
    {
      action: "fund",
      amount: "10",
      flags: "--address 0x2222222222222222222222222222222222222222 --amount 10",
    },
    {
      action: "mach",
      amount: "25",
      flags: "--mach --address 0x2222222222222222222222222222222222222222 --amount 25",
    },
    {
      action: "crypto",
      amount: null,
      flags: "--crypto --address 0x2222222222222222222222222222222222222222",
    },
    {
      action: "claim",
      amount: null,
      flags: "--referral-code REF123 --address 0x2222222222222222222222222222222222222222",
    },
  ] as const)(
    "restarts an expired $action funding for the same wallet and amount: $flags",
    async (row) => {
      const { action, amount, flags } = row;
      const activeWallet = "activeWallet" in row;
      // A logged-in wallet's funding is for the active wallet; an --address one for another.
      const target = activeWallet ? wallet : "0x2222222222222222222222222222222222222222";
      const url = fundUrl(action, {
        address: target,
        amount: amount ?? undefined,
        chainId: 4217,
        code: "REF123",
      });
      await savePendingFund(
        savedFunding({
          action,
          wallet: target,
          activeWallet,
          url,
          amount,
          expiresAt: 1_700_000_000,
        }),
      );
      mocks.readContract.mockResolvedValue(0n);

      expect(await fundStatusHandler({})).toMatchObject({
        cta: { commands: [{ command: `tempo wallet fund ${flags} --network mainnet` }] },
      });
    },
  );

  // The 20 ms reads outlast the expired funding's zero-length wait.
  it.each([
    {
      name: "reports funds that arrived before expiry",
      read: () => new Promise((resolve) => setTimeout(resolve, 20, 1n)),
      result: { status: "success", raw_balance: "1" },
      kept: false,
    },
    {
      name: "keeps the funding when its last read fails",
      read: () => new Promise((_, reject) => setTimeout(reject, 20, new Error("RPC down"))),
      result: { code: "E_NETWORK", retryable: true },
      kept: true,
    },
  ])("checks an expired funding once more and $name", async ({ read, result, kept }) => {
    await savePendingFund(savedFunding({ expiresAt: 1_700_000_000 }));
    mocks.readContract.mockImplementation(read);

    expect(await fundStatusHandler({})).toMatchObject(result);
    expect(Boolean(await loadPendingFund())).toBe(kept);
  });
});
