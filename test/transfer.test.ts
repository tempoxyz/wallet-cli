import { describe, expect, it } from "vitest";

import { transferTokens } from "../src/commands/transfer.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import {
  expectUsageError,
  testWallet,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const recipient = "0x1111111111111111111111111111111111111111";

describe("transferTokens", () => {
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

  it("uses the pathUSD symbol for Moderato token transfers", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await transferTokens({
      args: { amount: "1.5", token: moderatoToken, to: recipient },
      options: { "dry-run": true, network: "testnet" },
    });

    expect(result).toMatchObject({
      chain_id: 42431,
      symbol: "pathUSD",
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
