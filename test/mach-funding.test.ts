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
import { whoamiHandler } from "../src/commands/identity.js";
import { fundingAmount, machToken, machFundingToken } from "../src/shared/mach.js";

const wallet = "0x1111111111111111111111111111111111111111";
const token = "0x20c000000000000000000000f37de3740adec032";
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
  delete process.env.TEMPO_WALLET_FUND_TIMEOUT_MS;
});

describe("MACH funding", () => {
  it.each(["4.99", "100.01", "5.001"])(
    "rejects unsupported MACH checkout amount %s",
    async (amount) => {
      await expect(runFundingFlow({ action: "mach", amount, noWait: true })).rejects.toThrow(
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
  it("makes MACH the default and credits a canonical alias", () => {
    expect(fundAction({})).toBe("mach");
    expect(fundAction({ credits: true })).toBe("mach");
    expect(fundAction({ mach: true })).toBe("mach");
  });
  it("builds the shared funding protocol", () => {
    expect(fundUrl("credits", { address: wallet, chainId: 4217, amount: "12.34" })).toBe(
      `https://wallet.tempo.xyz/agent?action=fund&intent=mach&address=${wallet}&chainId=4217&amount=12.34`,
    );
  });
  it("returns a machine handoff without RPC, browser, or login", async () => {
    mocks.state.mockResolvedValue({ accounts: [] });
    expect(
      await runFundingFlow({
        action: "credits",
        address: wallet,
        amount: "5",
        noBrowser: true,
        noWait: true,
      }),
    ).toMatchObject({
      status: "pending",
      action: "mach",
      wallet,
      chain_id: 4217,
      amount: "5",
      balance: null,
    });
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it.each(["invalid", `0x${"0".repeat(40)}`])(
    "rejects invalid destination %s before handoff",
    async (address) => {
      await expect(runFundingFlow({ action: "mach", address, noWait: true })).rejects.toThrow(
        "Invalid wallet",
      );
    },
  );
  it("rejects unsupported testnet before reading balances", async () => {
    await expect(
      runFundingFlow({ action: "mach", network: "testnet", noWait: true }),
    ).rejects.toThrow("not supported");
    expect(mocks.readContract).not.toHaveBeenCalled();
  });
  it("polls the explicit wallet and MACH token until the entire requested delta arrives", async () => {
    mocks.readContract
      .mockResolvedValueOnce(10_000_000n)
      .mockResolvedValueOnce(10_000_001n)
      .mockResolvedValueOnce(14_999_999n)
      .mockResolvedValueOnce(15_000_000n);
    const result = await runFundingFlow({
      action: "mach",
      address: wallet,
      amount: "5",
      noBrowser: true,
    });
    expect(result).toMatchObject({ status: "success", balance: "15", raw_balance: "15000000" });
    expect(mocks.readContract).toHaveBeenCalledTimes(4);
    expect(mocks.readContract).toHaveBeenLastCalledWith(
      expect.objectContaining({
        address: machToken(4217),
        functionName: "balanceOf",
        args: [wallet],
      }),
    );
  });
  it("does not convert an RPC failure to a zero or success balance", async () => {
    mocks.readContract.mockRejectedValue(new Error("RPC down"));
    await expect(runFundingFlow({ action: "mach", noBrowser: true })).rejects.toThrow("RPC down");
  });
  it("bounds a stalled balance RPC", async () => {
    mocks.readContract.mockImplementation(() => new Promise(() => {}));
    await expect(
      runFundingFlow({ action: "mach", noBrowser: true, timeout: 0.01 }),
    ).rejects.toThrow("Timed out waiting");
  });
  it("cancels a waiting operation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runFundingFlow({ action: "mach", noBrowser: true, signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });
  it.each([NaN, Infinity, -1])("rejects unbounded timeout %s", async (timeout) => {
    await expect(runFundingFlow({ action: "mach", noBrowser: true, timeout })).rejects.toThrow(
      "finite",
    );
  });
});

describe("MACH whoami", () => {
  it.each([{ mach: true }, { credits: true }])(
    "queries an on-chain balance and returns canonical MACH output %j",
    async (options) => {
      mocks.readContract.mockResolvedValue(1_234_567n);
      const result = await whoamiHandler(options);
      expect(result).toEqual({
        mach: {
          wallet,
          chain_id: 4217,
          token: machToken(4217),
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
      mach: { chain_id: 42431, token: machToken(42431), raw_balance: "123" },
    });
  });
  it("rejects mismatched wallet network", async () => {
    await expect(whoamiHandler({ mach: true, network: "testnet" })).rejects.toThrow("network");
  });
});
