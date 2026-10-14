import { decodeFunctionData, erc20Abi, formatUnits, toHex, type Hex } from "viem";
import { Abis, Addresses } from "viem/tempo";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  // The provider holds every wallet it is asked for unless a test says otherwise.
  getAccount: vi.fn(({ address }: { address: string }) => ({ address })),
  request: vi.fn(async (_request: { method: string; params: unknown[] }) => ({
    transactionHash: `0x${"cd".repeat(32)}`,
  })),
}));

vi.mock("../src/provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/provider.js")>()),
  createProvider: vi.fn(async () => ({ getAccount: mocks.getAccount, request: mocks.request })),
}));

import { swapTokens } from "../src/commands/swap.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import { machToken } from "../src/shared/mach.js";
import { parseNetwork } from "../src/shared/network.js";
import {
  containsSymbol,
  expectTokenError,
  expectUsageError,
  invalidTokenInputs,
  readyWallet,
  testnetUsdc,
  testWallet,
  tokenInputs,
  unlistedToken,
  untrustedSymbols,
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

// Unlisted tokens, so their decimals come from the on-chain metadata read.
const decimalIn = unlistedToken;
const decimalOut = "0x20c000000000000000000000000000000000cafe";

function decimalDependencies(decimalsIn: number, decimalsOut: number) {
  return dependencies({
    getBalance: vi.fn(async () => 10n ** 30n),
    getMetadata: vi.fn(async (token: string) =>
      token === decimalIn
        ? { decimals: decimalsIn, symbol: "IN" }
        : { decimals: decimalsOut, symbol: "OUT" },
    ),
  });
}

describe("swapTokens", () => {
  it.each([
    ["", 6, 6, false],
    ["0", 6, 6, false],
    ["0.000000", 6, 6, true],
    ["-1", 6, 6, false],
    ["abc", 6, 6, false],
    ["1e3", 6, 6, false],
    ["0x10", 6, 6, false],
    [" 1", 6, 6, false],
    ["1.", 6, 6, false],
    [".5", 6, 6, false],
    ["1.1234567", 6, 6, false],
    ["1.1234567", 6, 6, true],
    ["1.1234567", 6, 18, false],
    ["1.1234567", 18, 6, true],
    ["1.0000000000000000001", 18, 18, false],
    ["1.0000000000000000001", 6, 18, true],
    ["1.5", 0, 6, false],
  ] as const)(
    "rejects amount %j (decimals in %i, out %i, exact-out %s) before quoting",
    async (amount, decimalsIn, decimalsOut, exactOut) => {
      await useTempHome();
      await writeWalletState(walletState());
      const decimals = exactOut ? decimalsOut : decimalsIn;

      for (const dryRun of [true, false]) {
        const runtime = decimalDependencies(decimalsIn, decimalsOut);
        const error = await swapTokens(
          await readyWallet(),
          {
            args: { amount, tokenIn: decimalIn, tokenOut: decimalOut },
            options: { "dry-run": dryRun, "exact-out": exactOut, "slippage-bps": 50, yes: true },
          },
          runtime,
        ).catch((value: unknown) => value);

        expectUsageError(
          error,
          `Invalid amount: expected a positive decimal with at most ${decimals} decimals`,
        );
        expect(runtime.getBuyQuote).not.toHaveBeenCalled();
        expect(runtime.getSellQuote).not.toHaveBeenCalled();
        expect(runtime.getBalance).not.toHaveBeenCalled();
        expect(runtime.submit).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ["1.123456", 6, 18, false, 1_123_456n],
    ["1.1234567", 18, 6, false, 1_123_456_700_000_000_000n],
    ["0.000000000000000001", 18, 6, false, 1n],
    ["1.123456", 18, 6, true, 1_123_456n],
    ["1.1234567", 6, 18, true, 1_123_456_700_000_000_000n],
    ["0.000000000000000001", 6, 18, true, 1n],
    ["7", 0, 6, false, 7n],
  ] as const)(
    "quotes amount %j (decimals in %i, out %i, exact-out %s) without rounding",
    async (amount, decimalsIn, decimalsOut, exactOut, raw) => {
      await useTempHome();
      await writeWalletState(walletState());
      const runtime = decimalDependencies(decimalsIn, decimalsOut);

      const result = await swapTokens(
        await readyWallet(),
        {
          args: { amount, tokenIn: decimalIn, tokenOut: decimalOut },
          options: { "dry-run": true, "exact-out": exactOut, "slippage-bps": 50 },
        },
        runtime,
      );

      if (exactOut) {
        expect(runtime.getBuyQuote).toHaveBeenCalledWith({
          amountOut: raw,
          tokenIn: decimalIn,
          tokenOut: decimalOut,
        });
        expect(result).toMatchObject({ amount_out: amount, min_amount_out: amount });
      } else {
        expect(runtime.getSellQuote).toHaveBeenCalledWith({
          amountIn: raw,
          tokenIn: decimalIn,
          tokenOut: decimalOut,
        });
        expect(result).toMatchObject({ amount_in: amount, max_amount_in: amount });
      }
    },
  );

  it.each([
    ["mainnet", "tokenIn", machToken(4217)],
    ["mainnet", "tokenOut", "MACH"],
    ["testnet", "tokenIn", "mach"],
    ["testnet", "tokenOut", machToken(42431).toLowerCase()],
  ] as const)("rejects MACH on %s as %s (%s)", async (network, side, token) => {
    await useTempHome();
    await writeWalletState(
      walletState({
        accessKeys: [{ ...walletState().accessKeys[0]!, chainId: parseNetwork(network).chainId }],
      }),
    );
    const runtime = dependencies();
    const error = await swapTokens(
      await readyWallet(network),
      {
        args: {
          amount: "10",
          tokenIn: usdcToken,
          tokenOut: moderatoToken,
          [side]: token,
        },
        options: { "dry-run": true, "slippage-bps": 50 },
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
      await readyWallet(),
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
    if ("code" in result) throw new Error(result.message);
    expect(result.calls).toHaveLength(2);
    expect(result.calls.every((call) => /^0x[0-9a-f]+$/i.test(call.data))).toBe(true);
    expect(runtime.submit).not.toHaveBeenCalled();
  });

  it("rounds an exact-output maximum input up", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await swapTokens(
      await readyWallet(),
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
      await readyWallet(),
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
      await readyWallet(),
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

  it.each([
    { name: "an access key that has no stored limits", key: { limits: undefined } },
    // An interactive run without a usable key is approved in the wallet app.
    { name: "no usable access key", key: { expiry: 1 } },
  ])("submits with $name", async ({ key }) => {
    await useTempHome();
    const state = walletState();
    await writeWalletState({
      ...state,
      accessKeys: state.accessKeys.map((stored) => ({ ...stored, ...key })),
    });
    const runtime = dependencies();

    const result = await swapTokens(
      await readyWallet(undefined, false),
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
      await readyWallet(),
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
      from: testWallet,
      network: { name: "mainnet", chainId: 4217 },
    });
  });

  it.each([
    { name: "sends from the wallet it checked", replaced: false },
    { name: "sends nothing once another login replaced the wallet", replaced: true },
  ])("the wallet provider $name", async ({ replaced }) => {
    await useTempHome();
    await writeWalletState(walletState());
    const { submit: _submit, ...lookups } = dependencies();
    if (replaced)
      mocks.getAccount.mockImplementationOnce(() => {
        throw new Error(`Account "${testWallet}" not found.`);
      });

    const result = swapTokens(
      await readyWallet(),
      {
        args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
        options: { "slippage-bps": 50, yes: true },
      },
      lookups,
    );

    if (replaced) {
      await expect(result).rejects.toThrow(
        `Wallet ${testWallet.toLowerCase()} is no longer logged in, so nothing was sent. Check the login with 'tempo wallet whoami', then retry.`,
      );
      await expect(result).rejects.toMatchObject({ code: "E_NOT_AUTHENTICATED" });
      expect(mocks.request).not.toHaveBeenCalled();
    } else {
      await expect(result).resolves.toMatchObject({ status: "success" });
      expect(mocks.request).toHaveBeenCalledWith({
        method: "eth_sendTransactionSync",
        params: [expect.objectContaining({ from: testWallet, feeToken: usdcToken })],
      });
    }
    // The balance and the sender are the same wallet.
    expect(lookups.getBalance).toHaveBeenCalledWith({ account: testWallet, token: usdcToken });
    expect(mocks.getAccount).toHaveBeenCalledWith({ address: testWallet });
  });

  // The provider sends on the wallet's saved chain unless the request names one.
  it.each([
    { name: "the saved chain", stored: 4217, network: "mainnet" },
    { name: "--network testnet over a mainnet login", stored: 4217, network: "testnet" },
    { name: "--network mainnet over a testnet login", stored: 42431, network: "mainnet" },
  ] as const)("sends on the reviewed network with $name", async ({ stored, network }) => {
    await useTempHome();
    const key = { ...walletState().accessKeys[0]!, limits: undefined };
    await writeWalletState(
      walletState({ chainId: stored, accessKeys: [key, { ...key, chainId: 42431 }] }),
    );
    const { chainId } = parseNetwork(network);
    const { submit: _submit, ...lookups } = dependencies();
    mocks.request.mockClear();

    const result = await swapTokens(
      await readyWallet(network),
      {
        args: { amount: "10", tokenIn: "pathUSD", tokenOut: "USDC.e" },
        options: { "slippage-bps": 50, yes: true },
      },
      lookups,
    );

    expect(result).toMatchObject({ status: "success", chain_id: chainId });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith({
      method: "eth_sendTransactionSync",
      params: [
        {
          from: testWallet,
          calls: [
            expect.objectContaining({ to: moderatoToken }),
            expect.objectContaining({ to: Addresses.stablecoinDex }),
          ],
          chainId: toHex(chainId),
          feeToken: moderatoToken,
        },
      ],
    });
  });

  // Without an access key for the selected network the wallet app signs, and only on the chain
  // the wallet is logged in on. A dry run only reads the quote, so it is never refused.
  const keyless = [
    {
      name: "--network testnet over a mainnet login",
      stored: 4217,
      network: "testnet",
      refusal:
        "wallet is logged in on tempo, not tempo-moderato, and has no access key for tempo-moderato",
    },
    {
      name: "--network mainnet over a testnet login",
      stored: 42431,
      network: "mainnet",
      refusal: "wallet is logged in on tempo-moderato, not tempo, and has no access key for tempo",
    },
    { name: "the logged-in mainnet chain", stored: 4217, network: "mainnet", refusal: undefined },
    { name: "the logged-in testnet chain", stored: 42431, network: "testnet", refusal: undefined },
  ] as const;

  it.each(keyless)(
    "a swap without an access key, on $name",
    async ({ stored, network, refusal }) => {
      await useTempHome();
      const expired = { ...walletState().accessKeys[0]!, chainId: stored, expiry: 1 };
      await writeWalletState(walletState({ chainId: stored, accessKeys: [expired] }));
      const { chainId } = parseNetwork(network);
      // Interactive runs reach the swap without a usable key.
      const wallet = await readyWallet(network, false);
      const { submit: _submit, ...lookups } = dependencies();
      const args = {
        amount: "10",
        tokenIn: moderatoToken,
        tokenOut: network === "testnet" ? testnetUsdc : usdcToken,
      };
      mocks.request.mockClear();

      const dryRun = await swapTokens(
        wallet,
        { args, options: { "dry-run": true, "slippage-bps": 50 } },
        lookups,
      );
      const result = await swapTokens(
        wallet,
        { args, options: { "slippage-bps": 50, yes: true } },
        lookups,
      );

      const command = `tempo wallet login --network ${network}`;
      expect(dryRun).toMatchObject({ status: "dry_run", chain_id: chainId });
      expect(result).toEqual(
        refusal
          ? {
              code: "E_USAGE",
              message: `Swap not submitted: ${refusal}; log in with '${command}', then rerun the swap.`,
              exitCode: 2,
              retryable: false,
              cta: { commands: [{ command }] },
            }
          : expect.objectContaining({ status: "success", chain_id: chainId }),
      );
      expect(mocks.request.mock.calls).toEqual(
        refusal
          ? []
          : [
              [
                {
                  method: "eth_sendTransactionSync",
                  params: [expect.objectContaining({ chainId: toHex(chainId) })],
                },
              ],
            ],
      );
    },
  );

  it("rejects quotes that exceed the available input balance", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await swapTokens(
      await readyWallet(),
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
        await readyWallet(),
        {
          args: { amount: "10", tokenIn: usdcToken, tokenOut: moderatoToken },
          options: { "slippage-bps": 50, ...options, ...mode },
        },
        runtime,
      );
      if ("code" in result) throw new Error(result.message);
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
        await readyWallet(),
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
      await readyWallet(),
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
  it.each(tokenInputs)(
    "resolves $input on $network as tokenIn, tokenOut, and --fee-token",
    async ({ input, network, address, symbol }) => {
      await useTempHome();
      const chainId = parseNetwork(network).chainId;
      const key = { ...walletState().accessKeys[0]!, chainId, limits: undefined };
      await writeWalletState(walletState({ chainId, accessKeys: [key] }));

      for (const side of ["in", "out"] as const) {
        const [tokenIn, tokenOut] = side === "in" ? [input, unlistedToken] : [unlistedToken, input];
        const [resolvedIn, resolvedOut] =
          side === "in" ? [address, unlistedToken] : [unlistedToken, address];
        const runtime = dependencies();
        const result = await swapTokens(
          await readyWallet(network, false),
          {
            args: { amount: "10", tokenIn, tokenOut },
            options: { "dry-run": true, "fee-token": input, "slippage-bps": 50 },
          },
          runtime,
        );

        expect(result).toMatchObject({
          token_in: resolvedIn,
          token_out: resolvedOut,
          [`token_${side}_symbol`]: symbol,
          fee_token: address,
        });
        // Continuations carry the resolved addresses rather than the typed symbol.
        const argv = (result as { _next?: { argv: string[] } })._next?.argv ?? [];
        expect(argv.slice(3, 6)).toEqual(["10", resolvedIn, resolvedOut]);
        expect(argv[argv.indexOf("--fee-token") + 1]).toBe(address);
        expect(runtime.getMetadata.mock.calls).toEqual([[unlistedToken]]);
      }
    },
  );

  it.each(
    (["tokenIn", "tokenOut", "fee-token"] as const).flatMap((position) =>
      invalidTokenInputs(position === "fee-token" ? "fee token" : "token").map((row) => ({
        ...row,
        position,
      })),
    ),
  )(
    "rejects $position $input on $network before quoting",
    async ({ position, input, network, message }) => {
      await useTempHome();
      await writeWalletState(walletState());
      const runtime = dependencies();
      const args: { amount: string; tokenIn: string; tokenOut: string } = {
        amount: "10",
        tokenIn: usdcToken,
        tokenOut: moderatoToken,
      };
      if (position !== "fee-token") args[position] = input;

      const error = await swapTokens(
        await readyWallet(network, false),
        {
          args,
          options: {
            "dry-run": true,
            "slippage-bps": 50,
            ...(position === "fee-token" ? { "fee-token": input } : {}),
          },
        },
        runtime,
      ).catch((value: unknown) => value);

      expectTokenError(error, message);
      expect(runtime.getMetadata).not.toHaveBeenCalled();
      expect(runtime.getSellQuote).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["USDC", "USDC.e"],
    ["pathUSD", moderatoToken],
  ])("rejects %s and %s as the same token", async (tokenIn, tokenOut) => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await swapTokens(
      await readyWallet(),
      {
        args: { amount: "10", tokenIn, tokenOut },
        options: { "dry-run": true, "slippage-bps": 50 },
      },
      dependencies(),
    ).catch((value: unknown) => value);

    expectUsageError(error, "Invalid swap: tokenIn and tokenOut must be different");
  });

  it.each(untrustedSymbols)(
    "names an unlisted token by its address, never its on-chain symbol %j",
    async (symbol) => {
      await useTempHome();
      await writeWalletState(walletState());
      const getMetadata = vi.fn(async () => ({ decimals: 6, symbol }));

      // The key only covers USDC.e, so spending the unlisted token needs a keys update.
      const dryRun = await swapTokens(
        await readyWallet(),
        {
          args: { amount: "10", tokenIn: unlistedToken, tokenOut: moderatoToken },
          options: { "dry-run": true, "slippage-bps": 50 },
        },
        dependencies({ getMetadata }),
      );
      const quoteMoved = await swapTokens(
        await readyWallet(),
        {
          args: { amount: "10", tokenIn: usdcToken, tokenOut: unlistedToken },
          options: { "dry-run": true, "slippage-bps": 50, "min-amount-out": "9.81" },
        },
        dependencies({ getMetadata }),
      ).catch((value: unknown) => value);
      const insufficient = await swapTokens(
        await readyWallet(),
        {
          args: { amount: "10", tokenIn: unlistedToken, tokenOut: moderatoToken },
          options: { "dry-run": true, "slippage-bps": 50 },
        },
        dependencies({ getMetadata, getBalance: vi.fn(async () => 0n) }),
      ).catch((value: unknown) => value);

      expect(dryRun).toMatchObject({
        token_in: unlistedToken,
        token_in_symbol: null,
        requires_access_key_update: true,
        instruction: expect.stringContaining(`cannot spend 10 ${unlistedToken}.`),
      });
      expect(quoteMoved).toMatchObject({
        message: expect.stringContaining(`now returns 9.8 ${unlistedToken}, below`),
      });
      expect(insufficient).toMatchObject({
        message: expect.stringContaining(`Insufficient ${unlistedToken} balance`),
      });
      for (const output of [dryRun, (quoteMoved as Error).message, (insufficient as Error).message])
        expect(containsSymbol(output, symbol)).toBe(false);
    },
  );
});
