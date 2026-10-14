import { describe, expect, it, vi } from "vitest";

import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { machToken } from "../src/shared/mach.js";
import { parseNetwork } from "../src/shared/network.js";
import {
  knownTokens,
  listedSymbol,
  resolveTokenAddress,
  tickerSymbol,
  tokenLabel,
  tokenMetadata,
  tokenSymbol,
} from "../src/shared/tokens.js";
import {
  expectTokenError,
  expectUsageError,
  invalidTokenInputs,
  ousdToken,
  testnetUsdc,
  tokenInputs,
  unlistedToken,
  untrustedSymbols,
} from "./helpers.js";

const mach = machToken(4217).toLowerCase();

function thrown(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return expect.unreachable("expected an error");
}

describe("resolveTokenAddress", () => {
  it.each([
    ...tokenInputs,
    { input: "MACH", network: "mainnet", address: mach },
    { input: "mach", network: "testnet", address: mach },
    {
      input: "alphaUSD",
      network: "testnet",
      address: "0x20c0000000000000000000000000000000000001",
    },
    { input: "EURC", network: "testnet", address: "0x20c000000000000000000000d72572838bbee59c" },
    { input: "usdt0", network: "mainnet", address: "0x20c00000000000000000000014f22ca97301eb73" },
    { input: unlistedToken, network: "testnet", address: unlistedToken },
  ])("resolves $input on $network to $address", ({ input, network, address }) => {
    expect(resolveTokenAddress(input, parseNetwork(network))).toBe(address);
  });

  it.each(["mainnet", "testnet"])("resolves every token listed on %s by its symbol", (name) => {
    const network = parseNetwork(name);
    for (const token of knownTokens(network.chainId)) {
      expect(resolveTokenAddress(token.symbol, network)).toBe(token.address);
      expect(resolveTokenAddress(token.address.toUpperCase().replace("0X", "0x"), network)).toBe(
        token.address,
      );
    }
  });

  it.each(invalidTokenInputs("token"))(
    "rejects $input on $network",
    ({ input, network, message }) => {
      expectTokenError(
        thrown(() => resolveTokenAddress(input, parseNetwork(network))),
        message,
      );
    },
  );

  it.each([
    {
      input: "usdt",
      label: "fee token",
      message:
        'Unknown fee token "usdt" on testnet. Use a 0x address or one of: alphaUSD, betaUSD, EURC.e, pathUSD, thetaUSD, USDC.e, MACH',
    },
    {
      input: "USDC\u200b",
      label: "token",
      message:
        'Unknown token "USDC\\u200b" on testnet. Use a 0x address or one of: alphaUSD, betaUSD, EURC.e, pathUSD, thetaUSD, USDC.e, MACH',
    },
  ])("lists the testnet symbols when $input is unknown", ({ input, label, message }) => {
    expectUsageError(
      thrown(() => resolveTokenAddress(input, parseNetwork("testnet"), label)),
      message,
    );
  });
});

describe("tickerSymbol", () => {
  it.each(["mainnet", "testnet"])("keeps every symbol viem lists on %s", (name) => {
    for (const token of knownTokens(parseNetwork(name).chainId))
      expect(tickerSymbol(token.symbol)).toBe(token.symbol);
  });

  it.each<{ value: string; symbol: string | null }>([
    { value: "\u001b[31mEVIL\u200b", symbol: "EVIL" },
    { value: "syrupUSDC", symbol: "syrupUSDC" },
    { value: "A".repeat(16), symbol: "A".repeat(16) },
    { value: "", symbol: null },
    ...untrustedSymbols.map((value) => ({ value, symbol: null })),
  ])("reads $value as $symbol", ({ value, symbol }) => {
    expect(tickerSymbol(value)).toBe(symbol);
  });
});

describe("listedSymbol", () => {
  it.each(["usdc", "USDC.e", "alphaUSD", "ousd", "MACH"])(
    "keeps %s, which some network lists",
    (symbol) => {
      expect(listedSymbol(symbol)).toBe(symbol);
    },
  );

  it("rejects a symbol no network lists, naming every network's symbols", () => {
    expectUsageError(
      thrown(() => listedSymbol("usdt", "payment token")),
      `Unknown payment token "usdt". Use a 0x address or one of: ${[
        ...new Set(
          [4217, 42431].flatMap((chain) => knownTokens(chain).map((token) => token.symbol)),
        ),
      ].join(", ")}`,
    );
  });
});

describe("tokenSymbol", () => {
  it.each([
    { token: machToken(4217), chain: 4217, symbol: "MACH" },
    { token: machToken(42431), chain: 42431, symbol: "MACH" },
    { token: ousdToken.toUpperCase().replace("0X", "0x"), chain: 4217, symbol: "OUSD" },
    { token: ousdToken, chain: 42431, symbol: undefined },
    { token: moderatoToken, chain: 42431, symbol: "pathUSD" },
    { token: usdcToken, chain: 4217, symbol: "USDC.e" },
    { token: usdcToken, chain: 42431, symbol: undefined },
    { token: testnetUsdc, chain: 42431, symbol: "USDC.e" },
    { token: unlistedToken, chain: 4217, symbol: undefined },
  ])("names $token on chain $chain $symbol", ({ token, chain, symbol }) => {
    expect(tokenSymbol(token, chain)).toBe(symbol);
  });
});

describe("tokenMetadata", () => {
  it("uses viem's listing without reading listed tokens on chain", async () => {
    const read = vi.fn();

    expect(await tokenMetadata(ousdToken, 4217, read)).toEqual({
      address: ousdToken,
      symbol: "OUSD",
      decimals: 6,
    });
    const usdc = resolveTokenAddress("USDC", parseNetwork("testnet"));
    expect(await tokenMetadata(usdc, 42431, read)).toEqual({
      address: testnetUsdc,
      symbol: "USDC.e",
      decimals: 6,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads an unlisted token on chain and sanitizes its symbol", async () => {
    const read = vi.fn(async () => ({ decimals: 18, symbol: "\u001b[31mEVIL\u200b\u202e" }));

    const address = resolveTokenAddress(
      unlistedToken.toUpperCase().replace("0X", "0x"),
      parseNetwork("mainnet"),
    );
    expect(await tokenMetadata(address, 4217, read)).toEqual({
      address: unlistedToken,
      symbol: "EVIL",
      decimals: 18,
    });
    expect(read).toHaveBeenCalledWith(unlistedToken);
  });

  it.each(untrustedSymbols)(
    "drops on-chain symbol %j and labels the token by its address",
    async (symbol) => {
      const read = vi.fn(async () => ({ decimals: 6, symbol }));

      const token = await tokenMetadata(unlistedToken, 4217, read);

      expect(token).toEqual({ address: unlistedToken, symbol: null, decimals: 6 });
      expect(tokenLabel(token)).toBe(unlistedToken);
    },
  );

  it("reports an unreadable token as a network error", async () => {
    const read = vi.fn(async () => {
      throw new Error("execution reverted");
    });

    await expect(tokenMetadata(unlistedToken, 4217, read)).rejects.toMatchObject({
      code: "E_NETWORK",
      message: `Unable to read token metadata for ${unlistedToken}. Check the token address and RPC connectivity (TEMPO_RPC_URL).`,
    });
  });
});
