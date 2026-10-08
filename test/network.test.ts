import { afterEach, describe, expect, it } from "vitest";

import { chainId, isTestnet, tokenSymbol } from "../src/shared/network.js";
import { moderatoToken, ousdToken, usdcToken } from "../src/shared/constants.js";

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
  [usdcToken, "USDC.e"],
  [ousdToken, "OUSD"],
  [ousdToken.toUpperCase().replace("0X", "0x"), "OUSD"],
  [moderatoToken, "PathUSD"],
  ["0x1111111111111111111111111111111111111111", "0x1111111111111111111111111111111111111111"],
])("displays %s as %s", (token, symbol) => {
  expect(tokenSymbol(token)).toBe(symbol);
});
