import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMetadata: vi.fn(
    async (
      _client: unknown,
      _parameters: { token: string },
    ): Promise<{ decimals: number; symbol: string }> => {
      throw new Error("no metadata");
    },
  ),
}));

vi.mock("viem/tempo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/tempo")>();
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      token: { ...actual.Actions.token, getMetadata: mocks.getMetadata },
    },
  };
});

import { transferTokens } from "../src/commands/transfer.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import {
  containsSymbol,
  expectTokenError,
  expectUsageError,
  invalidTokenInputs,
  readyWallet,
  testWallet,
  testWallet2,
  tokenInputs,
  unlistedToken,
  untrustedSymbols,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const recipient = "0x1111111111111111111111111111111111111111";
const usage = "usage: tempo wallet transfer <amount> <token> <to>";
const amountError = "Invalid amount: expected a positive decimal with at most 6 decimals";

describe("transferTokens", () => {
  it.each([
    [{ token: usdcToken, to: recipient }, `missing <amount>; ${usage}`],
    [{ amount: "1", to: recipient }, `missing <token>; ${usage}`],
    [{ amount: "1", token: usdcToken }, `missing <to>; ${usage}`],
    [{ to: recipient }, `missing <amount>, <token>; ${usage}`],
    [{ token: usdcToken }, `missing <amount>, <to>; ${usage}`],
    [{ amount: "1" }, `missing <token>, <to>; ${usage}`],
    [{}, `missing <amount>, <token>, <to>; ${usage}`],
    [
      { amount: "1", token: "0x1234", to: recipient },
      "Invalid token address: expected a full 0x address",
    ],
    [
      { amount: "1", token: usdcToken, to: "0x1234" },
      "Invalid recipient address: expected a full 0x address",
    ],
    [
      { amount: "1", token: usdcToken, to: "0x70997970C51812dc3A010C7d01b50e0d17dc79c8" },
      "Invalid recipient address: expected a full 0x address",
    ],
    [
      { amount: "1", token: usdcToken, to: "0x0000000000000000000000000000000000000000" },
      "Invalid recipient address: cannot transfer to the zero address",
    ],
  ])("rejects invalid input %j in dry runs and sends alike", async (args, message) => {
    await useTempHome();
    await writeWalletState(walletState());
    const wallet = await readyWallet();

    for (const dryRun of [true, false]) {
      const error = await transferTokens(wallet, { args, options: { "dry-run": dryRun } }).catch(
        (err: unknown) => err,
      );
      expectUsageError(error, message);
    }
  });

  it.each(["", "-1", "0", "0.000000", "1.1234567", "abc", "1e3", "0x10", " 1", "1."])(
    "rejects amount %j",
    async (amount) => {
      await useTempHome();
      await writeWalletState(walletState());

      for (const dryRun of [true, false]) {
        const error = await transferTokens(await readyWallet(), {
          args: { amount, token: usdcToken, to: recipient },
          options: { "dry-run": dryRun },
        }).catch((err: unknown) => err);
        expectUsageError(error, amountError);
      }
    },
  );

  it.each(["1", "0.000001", "1.123456", "1000000"])(
    "accepts amount %s in dry-run",
    async (amount) => {
      await useTempHome();
      await writeWalletState(walletState());

      const result = await transferTokens(await readyWallet(), {
        args: { amount, token: usdcToken, to: testWallet2 },
        options: { "dry-run": true },
      });

      expect(result).toMatchObject({ status: "dry_run", amount, to: testWallet2.toLowerCase() });
    },
  );

  it("returns dry-run output for token transfers", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await transferTokens(await readyWallet(), {
      args: { amount: "1.5", token: usdcToken, to: recipient },
      options: { "dry-run": true },
    });

    expect(result).toEqual({
      status: "dry_run",
      chain_id: 4217,
      network: "tempo",
      amount: "1.5",
      symbol: "USDC.e",
      token: usdcToken,
      to: recipient,
      from: testWallet.toLowerCase(),
      instruction: expect.any(String),
      _next: expect.any(Object),
    });
  });

  it("uses the pathUSD symbol for Moderato token transfers", async () => {
    await useTempHome();
    await writeWalletState(
      walletState({ accessKeys: [{ ...walletState().accessKeys[0]!, chainId: 42431 }] }),
    );

    const result = await transferTokens(await readyWallet("testnet"), {
      args: { amount: "1.5", token: moderatoToken, to: recipient },
      options: { "dry-run": true },
    });

    expect(result).toMatchObject({
      chain_id: 42431,
      symbol: "pathUSD",
      token: moderatoToken,
    });
  });

  it("reports --address as the dry-run sender", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await transferTokens(await readyWallet(), {
      args: { amount: "1", token: usdcToken, to: recipient },
      options: { "dry-run": true, address: testWallet2 },
    });

    expect(result).toMatchObject({ from: testWallet2.toLowerCase() });
  });
  it.each(tokenInputs)(
    "resolves $input on $network as the token and --fee-token",
    async ({ input, network, address, symbol }) => {
      await useTempHome();
      await writeWalletState(walletState());

      const result = await transferTokens(await readyWallet(network, false), {
        args: { amount: "1.5", token: input, to: recipient },
        options: { "dry-run": true, "fee-token": input },
      });

      expect(result).toMatchObject({ status: "dry_run", amount: "1.5", symbol, token: address });
      // Continuations carry the resolved addresses rather than the typed symbol.
      expect((result as { _next: { argv: string[] } })._next.argv.slice(2, 8)).toEqual([
        "transfer",
        "1.5",
        address,
        recipient,
        "--fee-token",
        address,
      ]);
    },
  );

  it.each(
    (["token", "fee-token"] as const).flatMap((position) =>
      invalidTokenInputs(position === "token" ? "token" : "fee token").map((row) => ({
        ...row,
        position,
      })),
    ),
  )("rejects $position $input on $network", async ({ position, input, network, message }) => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await transferTokens(await readyWallet(network, false), {
      args: { amount: "1", token: position === "token" ? input : moderatoToken, to: recipient },
      options: {
        "dry-run": true,
        ...(position === "fee-token" ? { "fee-token": input } : {}),
      },
    }).catch((err: unknown) => err);

    expectTokenError(error, message);
  });
  it("reads an unlisted token's decimals and sanitized symbol on chain", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    mocks.getMetadata.mockResolvedValue({ decimals: 2, symbol: "\u001b[2JTWO\u200b" });

    const result = await transferTokens(await readyWallet(), {
      args: { amount: "1.25", token: unlistedToken, to: recipient },
      options: { "dry-run": true },
    });
    const error = await transferTokens(await readyWallet(), {
      args: { amount: "1.255", token: unlistedToken, to: recipient },
      options: { "dry-run": true },
    }).catch((err: unknown) => err);

    expect(result).toMatchObject({
      symbol: "TWO",
      token: unlistedToken,
      instruction: `Run the next command to send 1.25 TWO to ${recipient}.`,
    });
    expectUsageError(error, "Invalid amount: expected a positive decimal with at most 2 decimals");
    expect(mocks.getMetadata.mock.calls.map(([, parameters]) => parameters)).toEqual([
      { token: unlistedToken },
      { token: unlistedToken },
    ]);
  });

  it.each(untrustedSymbols)(
    "names an unlisted token by its address, never its on-chain symbol %j",
    async (symbol) => {
      await useTempHome();
      await writeWalletState(walletState());
      mocks.getMetadata.mockResolvedValue({ decimals: 6, symbol });

      const result = await transferTokens(await readyWallet(), {
        args: { amount: "1", token: unlistedToken, to: recipient },
        options: { "dry-run": true },
      });

      expect(result).toMatchObject({
        symbol: null,
        token: unlistedToken,
        instruction: `Run the next command to send 1 ${unlistedToken} to ${recipient}.`,
      });
      expect(containsSymbol(result, symbol)).toBe(false);
    },
  );
});
