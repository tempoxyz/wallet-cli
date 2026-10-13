import { describe, expect, it } from "vitest";

import { transferTokens } from "../src/commands/transfer.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import {
  expectUsageError,
  testWallet,
  testWallet2,
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
    [{ amount: "", token: usdcToken, to: recipient }, amountError],
    [{ amount: "-1", token: usdcToken, to: recipient }, amountError],
    [{ amount: "0", token: usdcToken, to: recipient }, amountError],
    [{ amount: "0.000000", token: usdcToken, to: recipient }, amountError],
    [{ amount: "1.1234567", token: usdcToken, to: recipient }, amountError],
    [{ amount: "abc", token: usdcToken, to: recipient }, amountError],
    [{ amount: "1e3", token: usdcToken, to: recipient }, amountError],
    [{ amount: "0x10", token: usdcToken, to: recipient }, amountError],
    [{ amount: " 1", token: usdcToken, to: recipient }, amountError],
    [{ amount: "1.", token: usdcToken, to: recipient }, amountError],
    [
      { amount: "1", token: "0x1234", to: recipient },
      "Invalid token address: expected a full 0x address",
    ],
    [
      { amount: "1", token: "USDC", to: recipient },
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
  ])("rejects invalid input %j before loading the wallet", async (args, message) => {
    await useTempHome();
    await writeWalletState(walletState({ accounts: [] }));

    for (const dryRun of [true, false]) {
      const error = await transferTokens({ args, options: { "dry-run": dryRun } }).catch(
        (err: unknown) => err,
      );
      expectUsageError(error, message);
    }
  });

  it.each(["1", "0.000001", "1.123456", "1000000"])(
    "accepts amount %s in dry-run",
    async (amount) => {
      await useTempHome();
      await writeWalletState(walletState());

      const result = await transferTokens({
        args: { amount, token: usdcToken, to: testWallet2 },
        options: { "dry-run": true },
      });

      expect(result).toMatchObject({ status: "dry_run", amount, to: testWallet2.toLowerCase() });
    },
  );

  it("returns dry-run output for token transfers", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await transferTokens({
      args: { amount: "1.5", token: usdcToken, to: recipient },
      options: { "dry-run": true },
    });

    expect(result).toEqual({
      status: "dry_run",
      chain_id: 4217,
      amount: "1.5",
      symbol: "USDC.e",
      token: usdcToken,
      to: recipient,
      from: testWallet.toLowerCase(),
    });
  });

  it("uses the PathUSD symbol for Moderato token transfers", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await transferTokens({
      args: { amount: "1.5", token: moderatoToken, to: recipient },
      options: { "dry-run": true, network: "testnet" },
    });

    expect(result).toMatchObject({
      chain_id: 42431,
      symbol: "PathUSD",
      token: moderatoToken,
    });
  });

  it("throws E_USAGE for token dry-run without a wallet even when --address is set", async () => {
    await useTempHome();
    await writeWalletState(walletState({ accounts: [] }));

    const error = await transferTokens({
      args: { amount: "1", token: usdcToken, to: recipient },
      options: { "dry-run": true, address: recipient },
    }).catch((err: unknown) => err);

    expectUsageError(
      error,
      "Configuration missing: No wallet configured. Run 'tempo wallet login'.",
    );
  });
});
