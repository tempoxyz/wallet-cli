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
import { fundAction, fundUrl, runFundingFlow } from "../src/commands/fund.js";
import { whoamiHandler } from "../src/commands/whoami.js";
import { fundingAmount, machToken, machFundingToken } from "../src/shared/mach.js";
import { appUrl } from "../src/shared/network.js";
import { useTempHome } from "./helpers.js";

const wallet = "0x1111111111111111111111111111111111111111";
const token = "0x20c000000000000000000000f37de3740adec032";
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
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.TEMPO_WALLET_FUND_POLL_MS = "1";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TEMPO_WALLET_FUND_POLL_MS;
  delete process.env.TEMPO_WALLET_FUND_TIMEOUT_MS;
});

describe("MACH funding", () => {
  it("rejects legacy credit funding before wallet, RPC, or browser access", async () => {
    mocks.state.mockClear();
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(runFundingFlow({ action: "credits" })).rejects.toMatchObject({
      code: "E_USAGE",
      message: expect.stringContaining("tempo wallet fund --mach"),
    });
    expect(() => fundUrl("credits")).toThrow("tempo wallet fund --mach");
    expect(mocks.state).not.toHaveBeenCalled();
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["4.99", "100.01", "5.001"])(
    "rejects unsupported MACH checkout amount %s",
    async (amount) => {
      await expect(runFundingFlow({ action: "mach", amount })).rejects.toThrow(
        "between 5 and 100 USD",
      );
    },
  );
  it("uses authoritative deployments and rejects testnet funding", () => {
    expect(machToken(4217).toLowerCase()).toBe(token);
    expect(machToken(42431)).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(() => machFundingToken(42431)).toThrow("funding is not supported");
  });
  it.each(["0", "-1", "NaN", "Infinity", "1e2", "0.0000001", " 1", "1."])(
    "rejects invalid USD amount %s",
    (amount) => {
      expect(() => fundingAmount(amount)).toThrow("--amount");
    },
  );
  it("preserves exact six decimal amounts", () => {
    expect(fundingAmount("1.000001")).toBe(1000001n);
  });
  it("keeps MACH explicit", () => {
    expect(fundAction({})).toBe("fund");
    expect(fundAction({ mach: true })).toBe("mach");
  });
  it("builds the shared funding protocol", () => {
    expect(fundUrl("mach", { address: wallet, chainId: 4217, amount: "12.34" })).toBe(
      `${new URL("/agent", appUrl)}?action=fund&intent=mach&address=${wallet}&chainId=4217&amount=12.34`,
    );
  });
  it("returns a machine handoff without a browser or login", async () => {
    mocks.state.mockResolvedValue({ accounts: [] });
    mocks.readContract.mockResolvedValue(0n);
    expect(
      await runFundingFlow({
        action: "mach",
        address: wallet,
        amount: "5",
        noBrowser: true,
      }),
    ).toMatchObject({
      status: "pending",
      action: "mach",
      wallet,
      chain_id: 4217,
      token: machToken(4217),
      symbol: "MACH",
      amount: "5",
      balance: null,
      _next: { command: "tempo wallet fund status --interval 5 --network mainnet" },
    });
    expect(mocks.readContract).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ address: machToken(4217), args: [wallet] }),
    );
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it.each(["invalid", `0x${"0".repeat(40)}`])(
    "rejects invalid destination %s before handoff",
    async (address) => {
      await expect(runFundingFlow({ action: "mach", address })).rejects.toThrow("Invalid wallet");
    },
  );
  it("rejects unsupported testnet before reading balances", async () => {
    await expect(runFundingFlow({ action: "mach", network: "testnet" })).rejects.toThrow(
      "not supported",
    );
    expect(mocks.readContract).not.toHaveBeenCalled();
  });
});

describe("default funding", () => {
  it.each(["fund", "mach", "crypto", "claim"] as const)(
    "opens %s and returns a pending handoff that fund status resumes",
    async (action) => {
      mocks.readContract.mockResolvedValue(0n);
      const result = await runFundingFlow({ action, amount: "17.43", code: "REF123" });
      expect(result).toMatchObject({
        status: "pending",
        wallet,
        amount: "17.43",
        balance: null,
        raw_balance: null,
        _next: { command: "tempo wallet fund status --interval 5 --network mainnet" },
      });
      expect(mocks.open).toHaveBeenCalledExactlyOnceWith("url" in result ? result.url : "");
    },
  );
  it("returns a handoff without opening a browser or polling", async () => {
    process.env.TEMPO_WALLET_FUND_TIMEOUT_MS = "invalid";
    process.env.TEMPO_WALLET_FUND_POLL_MS = "invalid";
    mocks.readContract.mockResolvedValue(0n);
    const result = await runFundingFlow({ action: "fund", noBrowser: true });
    expect(result).toMatchObject({
      status: "pending",
      amount: null,
      balance: null,
      raw_balance: null,
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("returns a testnet handoff after reading the pathUSD balance once", async () => {
    mocks.readContract.mockResolvedValue(0n);
    const result = await runFundingFlow({ action: "fund", network: "testnet", amount: "0.000001" });
    expect(result).toMatchObject({
      status: "pending",
      chain_id: 42431,
      amount: "0.000001",
      token: "0x20c0000000000000000000000000000000000000",
      symbol: "pathUSD",
    });
    expect("url" in result && result.url).toContain("chainId=42431&amount=0.000001");
    expect(mocks.readContract).toHaveBeenCalledOnce();
  });
});

describe("MACH whoami", () => {
  it.each([{ mach: true }])(
    "queries an on-chain balance and returns canonical MACH output %j",
    async (options) => {
      mocks.readContract.mockResolvedValue(1_234_567n);
      const result = await whoamiHandler(options);
      expect(result).toEqual({
        mach: {
          wallet,
          chain_id: 4217,
          network: "tempo",
          token: machToken(4217).toLowerCase(),
          symbol: "MACH",
          decimals: 6,
          balance: "1.234567",
          raw_balance: "1234567",
        },
      });
    },
  );
  it("queries the authoritative testnet MACH deployment without enabling checkout", async () => {
    mocks.state.mockResolvedValue({
      accounts: [{ address: wallet }],
      activeAccount: 0,
      chainId: 42431,
    });
    mocks.readContract.mockResolvedValue(123n);
    expect(await whoamiHandler({ mach: true, network: "testnet" })).toMatchObject({
      mach: { chain_id: 42431, token: machToken(42431).toLowerCase(), raw_balance: "123" },
    });
  });
  it("queries the requested MACH network independently of the stored selection", async () => {
    mocks.readContract.mockResolvedValue(123n);
    expect(await whoamiHandler({ mach: true, network: "testnet" })).toMatchObject({
      mach: { chain_id: 42431, token: machToken(42431).toLowerCase(), raw_balance: "123" },
    });
  });
});
