import { decodeFunctionData, erc20Abi, formatUnits, type Hex } from "viem";
import { Abis } from "viem/tempo";
import { describe, expect, it, vi } from "vitest";

import { swapTokens } from "../src/commands/swap.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { machToken } from "../src/shared/mach.js";
import {
  expectUsageError,
  testWallet,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getBalance: vi.fn(async () => 100_000_000n),
    getMetadata: vi.fn(async (token: string) => ({
      decimals: 6,
      symbol: token.toLowerCase() === usdcToken ? "USDC.e" : "pathUSD",
    })),
    getBuyQuote: vi.fn(async () => 10_100_000n),
    getSellQuote: vi.fn(async () => 9_800_000n),
    submit: vi.fn(async () => `0x${"ab".repeat(32)}`),
    ...overrides,
  };
}

describe("swapTokens", () => {
  it.each([
    ["mainnet", 4217, "tokenIn"],
    ["mainnet", 4217, "tokenOut"],
    ["testnet", 42431, "tokenIn"],
    ["testnet", 42431, "tokenOut"],
  ] as const)("rejects MACH on %s (chain %i, %s)", async (network, chain, side) => {
    await useTempHome();
    await writeWalletState(walletState());
    const runtime = dependencies();
    const error = await swapTokens(
      {
        args: {
          amount: "10",
          tokenIn: usdcToken,
          tokenOut: moderatoToken,
          [side]: machToken(chain),
        },
        options: { network, "dry-run": true, "slippage-bps": 50 },
      },
      runtime,
    ).catch((value: unknown) => value);

    expectUsageError(
      error,
      "MACH cannot be swapped. Use 'tempo request --mach' to pay for supported services.",
    );
    expect(runtime.getMetadata).not.toHaveBeenCalled();
    expect(runtime.getBuyQuote).not.toHaveBeenCalled();
    expect(runtime.getSellQuote).not.toHaveBeenCalled();
    expect(runtime.submit).not.toHaveBeenCalled();
  });

  it("returns an exact-input quote with bounded output and review calldata", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const runtime = dependencies();

    const result = await swapTokens(
      {
        args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
        options: { "dry-run": true, "slippage-bps": 50 },
      },
      runtime,
    );

    expect(result).toMatchObject({
      status: "dry_run",
      chain_id: 4217,
      mode: "exact_in",
      from: testWallet.toLowerCase(),
      token_in: usdcToken,
      token_in_symbol: "USDC.e",
      token_out: moderatoToken,
      token_out_symbol: "pathUSD",
      amount_in: "10",
      max_amount_in: "10",
      amount_out: "9.8",
      min_amount_out: "9.751",
      slippage_bps: 50,
      fee_token: usdcToken,
      access_key_limit: "100",
      requires_access_key_update: false,
    });
    expect(result.calls).toHaveLength(2);
    expect(result.calls.every((call) => /^0x[0-9a-f]+$/i.test(call.data))).toBe(true);
    expect(runtime.submit).not.toHaveBeenCalled();
  });

  it("rounds an exact-output maximum input up", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await swapTokens(
      {
        args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
        options: { "dry-run": true, "exact-out": true, "slippage-bps": 50 },
      },
      dependencies(),
    );

    expect(result).toMatchObject({
      mode: "exact_out",
      amount_in: "10.1",
      max_amount_in: "10.1505",
      amount_out: "10",
      min_amount_out: "10",
    });
  });

  it("requires explicit confirmation after quote review", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await swapTokens(
      {
        args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
        options: { "slippage-bps": 50 },
      },
      dependencies(),
    ).catch((value: unknown) => value);

    expectUsageError(error, "Swap not submitted: review the quote with --dry-run, then pass --yes");
  });

  it("explains the access-key update required for an unauthorized input token", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await swapTokens(
      {
        args: { amount: "10", tokenIn: moderatoToken, tokenOut: usdcToken },
        options: { "slippage-bps": 50, yes: true },
      },
      dependencies(),
    ).catch((value: unknown) => value);

    expectUsageError(
      error,
      `Active access key cannot spend 10 pathUSD. Ask the wallet owner to run 'tempo wallet keys update --token ${moderatoToken} --limit 10' and retry.`,
    );
  });

  it("submits with an access key that has no stored limits", async () => {
    await useTempHome();
    const state = walletState();
    await writeWalletState({
      ...state,
      accessKeys: state.accessKeys.map((key) => ({ ...key, limits: undefined })),
    });
    const runtime = dependencies();

    const result = await swapTokens(
      {
        args: { amount: "10", tokenIn: moderatoToken, tokenOut: usdcToken },
        options: { "slippage-bps": 50, yes: true },
      },
      runtime,
    );

    expect(result).toMatchObject({
      status: "success",
      access_key_limit: null,
      requires_access_key_update: false,
    });
    expect(runtime.submit).toHaveBeenCalledOnce();
  });

  it("submits the reviewed calls through the local wallet provider", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const runtime = dependencies();

    const result = await swapTokens(
      {
        args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
        options: { "slippage-bps": 50, yes: true },
      },
      runtime,
    );

    expect(result).toMatchObject({ status: "success", tx_hash: `0x${"ab".repeat(32)}` });
    expect(runtime.submit).toHaveBeenCalledWith({
      calls: expect.any(Array),
      feeToken: usdcToken,
      network: undefined,
    });
  });

  it("rejects quotes that exceed the available input balance", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await swapTokens(
      {
        args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
        options: { "dry-run": true, "slippage-bps": 50 },
      },
      dependencies({ getBalance: vi.fn(async () => 9_000_000n) }),
    ).catch((value: unknown) => value);

    expectUsageError(error, "Insufficient USDC.e balance: need up to 10, have 9");
  });

  it.each([
    { name: "a stricter minimum output", options: { "min-amount-out": "9.76" }, bound: 9_760_000n },
    { name: "a looser minimum output", options: { "min-amount-out": "9.7" }, bound: 9_751_000n },
    {
      name: "a minimum output at the quote",
      options: { "min-amount-out": "9.8" },
      bound: 9_800_000n,
    },
    {
      name: "a stricter maximum input",
      options: { "exact-out": true, "max-amount-in": "10.12" },
      bound: 10_120_000n,
    },
    {
      name: "a looser maximum input",
      options: { "exact-out": true, "max-amount-in": "10.2" },
      bound: 10_150_500n,
    },
    {
      name: "a maximum input at the quote",
      options: { "exact-out": true, "max-amount-in": "10.1" },
      bound: 10_100_000n,
    },
  ])("submits the stricter of slippage and $name", async ({ options, bound }) => {
    await useTempHome();
    await writeWalletState(walletState());
    const exactOut = "exact-out" in options;

    for (const mode of [{ "dry-run": true }, { yes: true }]) {
      const runtime = dependencies();
      const result = await swapTokens(
        {
          args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
          options: { "slippage-bps": 50, ...options, ...mode },
        },
        runtime,
      );
      const [approve, swap] = result.calls;
      const { args } = decodeFunctionData({ abi: Abis.stablecoinDex, data: swap!.data as Hex });

      expect(args[3]).toBe(bound);
      expect(result[exactOut ? "max_amount_in" : "min_amount_out"]).toBe(formatUnits(bound, 6));
      if (exactOut)
        expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data as Hex }).args[1]).toBe(
          bound,
        );
      if ("yes" in mode)
        expect(runtime.submit).toHaveBeenCalledWith(
          expect.objectContaining({
            calls: [
              expect.objectContaining({ data: approve!.data }),
              expect.objectContaining({ data: swap!.data }),
            ],
          }),
        );
      expect(runtime.submit).toHaveBeenCalledTimes("yes" in mode ? 1 : 0);
    }
  });

  it.each([
    {
      options: { "min-amount-out": "9.81" },
      message:
        "Quote moved: 10 USDC.e now returns 9.8 pathUSD, below --min-amount-out 9.81. Rerun --dry-run without --min-amount-out to review a new quote.",
    },
    {
      options: { "exact-out": true, "max-amount-in": "10.09" },
      message:
        "Quote moved: 10 pathUSD now costs 10.1 USDC.e, above --max-amount-in 10.09. Rerun --dry-run without --max-amount-in to review a new quote.",
    },
  ])("refuses a fresh quote worse than $options", async ({ options, message }) => {
    await useTempHome();
    await writeWalletState(walletState());

    for (const mode of [{ "dry-run": true }, { yes: true }]) {
      const runtime = dependencies();
      const error = await swapTokens(
        {
          args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
          options: { "slippage-bps": 50, ...options, ...mode },
        },
        runtime,
      ).catch((value: unknown) => value);

      expect(error).toMatchObject({ code: "E_LIMIT_EXCEEDED", exitCode: 4, message });
      expect(runtime.submit).not.toHaveBeenCalled();
    }
  });

  const boundError = (flag: string) =>
    `Invalid ${flag}: expected a positive amount with at most 6 decimals`;

  it.each([
    ...["0", "0.000000", "abc", "-1", "", " 1", "1.", "1e3", "1.1234567"].flatMap((value) => [
      [{ "min-amount-out": value }, boundError("--min-amount-out")] as const,
      [{ "exact-out": true, "max-amount-in": value }, boundError("--max-amount-in")] as const,
    ]),
    [
      { "exact-out": true, "min-amount-out": "9" },
      "--min-amount-out applies to exact-input swaps; use --max-amount-in with --exact-out",
    ] as const,
    [
      { "max-amount-in": "11" },
      "--max-amount-in applies to --exact-out swaps; use --min-amount-out instead",
    ] as const,
  ])("rejects bound %j before quoting", async (options, message) => {
    await useTempHome();
    await writeWalletState(walletState());
    const runtime = dependencies();

    const error = await swapTokens(
      {
        args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
        options: { "dry-run": true, "slippage-bps": 50, ...options },
      },
      runtime,
    ).catch((value: unknown) => value);

    expectUsageError(error, message);
    expect(runtime.getBuyQuote).not.toHaveBeenCalled();
    expect(runtime.getSellQuote).not.toHaveBeenCalled();
  });
});
