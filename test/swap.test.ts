import { describe, expect, it, vi } from "vitest";

import { swapTokens } from "../src/commands/swap.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
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
});
