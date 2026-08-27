import { afterEach, describe, expect, it } from "vitest";

import { chainId, isTestnet } from "../src/shared/network.js";

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
