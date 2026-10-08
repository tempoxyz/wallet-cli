import { afterEach, describe, expect, it } from "vitest";
import { ousd, usdce } from "viem/tokens";

import { chainId, isTestnet, tokenSymbol } from "../src/shared/network.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";

afterEach(() => {
  delete process.env.TEMPO_WALLET_NETWORK;
});

describe("network selection", () => {
  it("uses mainnet by default", () => {
    expect(isTestnet(undefined)).toBe(false);
    expect(chainId(undefined)).toBe(4217);
  });

  it("uses testnet from the command option", () => {
    expect(isTestnet("testnet")).toBe(true);
    expect(chainId("testnet")).toBe(42431);
  });

  it("uses testnet from TEMPO_WALLET_NETWORK", () => {
    process.env.TEMPO_WALLET_NETWORK = "testnet";

    expect(isTestnet(undefined)).toBe(true);
    expect(chainId(undefined)).toBe(42431);
  });
});

it.each(["mainnet", "tempo"])("explicit %s overrides testnet environment", (network) => {
  process.env.TEMPO_WALLET_NETWORK = "testnet";
  expect(chainId(network)).toBe(4217);
});
it.each(["testnet", "tempo-moderato", "moderato"])("resolves %s consistently", (network) => {
  expect(chainId(network)).toBe(42431);
  process.env.TEMPO_WALLET_NETWORK = network;
  expect(chainId(undefined)).toBe(42431);
});
it("rejects unknown networks", () => {
  expect(() => chainId("typo")).toThrow("Unsupported network");
});

it.each([
  [usdcToken, 4217, "USDC.e"],
  [ousd(4217).address, 4217, "OUSD"],
  [ousd(4217).address.toUpperCase().replace("0X", "0x"), 4217, "OUSD"],
  [moderatoToken, 42431, "pathUSD"],
  [usdce(42431).address, 42431, "USDC.e"],
  [ousd(1).address, 4217, ousd(1).address],
  [
    "0x1111111111111111111111111111111111111111",
    4217,
    "0x1111111111111111111111111111111111111111",
  ],
])("displays %s on chain %s as %s", (token, chain, symbol) => {
  expect(tokenSymbol(token, chain)).toBe(symbol);
});
