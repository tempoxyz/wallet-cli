import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), open: vi.fn(), state: vi.fn() }));
vi.mock("../src/shared/network.js", async (original) => ({
  ...(await original<typeof import("../src/shared/network.js")>()),
  createTempoPublicClient: mocks.client,
}));
vi.mock("../src/shared/process.js", async (original) => ({
  ...(await original<typeof import("../src/shared/process.js")>()),
  openExternal: mocks.open,
}));
vi.mock("../src/wallet/store.js", async (original) => ({
  ...(await original<typeof import("../src/wallet/store.js")>()),
  loadWalletState: mocks.state,
}));
import { runFundingFlow } from "../src/commands/fund.js";
import { appUrl } from "../src/shared/network.js";
import { useTempHome } from "./helpers.js";

const wallet = "0x1111111111111111111111111111111111111111";
let walletDirectory: string;

beforeEach(async () => {
  walletDirectory = join(await useTempHome(), ".tempo", "wallet");
  mocks.state.mockResolvedValue({ accounts: [{ address: wallet }], chainId: 4217, accessKeys: [] });
  mocks.client.mockImplementation(() => {
    throw new Error("Funding must not call the RPC");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("funding handoff", () => {
  it.each([
    { action: "fund", network: "mainnet", query: "action=fund", chain: 4217 },
    { action: "crypto", network: "mainnet", query: "action=crypto", chain: 4217 },
    { action: "mach", network: "mainnet", query: "action=fund&intent=mach", chain: 4217 },
    { action: "claim", network: "mainnet", query: "claim=REF123", chain: 4217 },
    { action: "fund", network: "testnet", query: "action=fund", chain: 42431 },
    { action: "crypto", network: "testnet", query: "action=crypto", chain: 42431 },
    { action: "claim", network: "testnet", query: "claim=REF123", chain: 42431 },
  ] as const)(
    "opens $action on $network without RPC or saved funding",
    async ({ action, network, query, chain }) => {
      const result = await runFundingFlow({ action, network, amount: "17.43", code: "REF123" });
      const url = `${new URL("/agent", appUrl)}?${query}&address=${wallet}&chainId=${chain}&amount=17.43`;

      expect(result).toMatchObject({
        status: "pending",
        action,
        wallet,
        url,
        chain_id: chain,
        amount: "17.43",
        balance: null,
        raw_balance: null,
        instruction:
          "Complete funding in the wallet app. Check the destination wallet's balance before spending.",
      });
      expect(result).not.toHaveProperty("_next");
      expect(mocks.open).toHaveBeenCalledExactlyOnceWith(url);
      expect(mocks.client).not.toHaveBeenCalled();
      expect(await readdir(walletDirectory)).toEqual([]);
    },
  );

  it("ignores a leftover pending funding file from an older CLI", async () => {
    const file = join(walletDirectory, "pending-fund.json");
    await writeFile(file, "old funding state");
    const result = await runFundingFlow({ action: "fund", noBrowser: true });

    expect(result).toMatchObject({ status: "pending", amount: null });
    expect(result).not.toHaveProperty("_next");
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe("old funding state");
  });
});
