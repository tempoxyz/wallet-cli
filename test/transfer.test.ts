import { describe, expect, it } from "vitest";

import { transferCredits, transferTokens } from "../src/commands/transfer.js";
import { moderatoToken, usdcToken } from "../src/shared/constants.js";
import {
  expectUsageError,
  testWallet,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const recipient = "0x1111111111111111111111111111111111111111";

function buildMppChallenge(amount: string, overrides: Record<string, unknown> = {}) {
  const request = {
    amount,
    currency: usdcToken,
    recipient,
    methodDetails: { chainId: 4217 },
    ...overrides,
  };
  const encoded = Buffer.from(JSON.stringify(request), "utf8").toString("base64url");
  return `Payment realm="example", method="tempo", intent="charge", id="abc123", request="${encoded}"`;
}

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

describe("transferCredits", () => {
  it("returns dry-run output for direct credits transfers", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await transferCredits({
      options: { "dry-run": true, "amount-cents": 250, to: recipient },
    });

    expect(result).toEqual({
      wallet: testWallet.toLowerCase(),
      amount_cents: 250,
      dry_run: true,
    });
  });

  it("returns dry-run output for direct credits transfers with data and zero value", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await transferCredits({
      options: {
        "dry-run": true,
        "amount-cents": 100,
        to: recipient,
        data: "0xabcdef",
        value: "0",
      },
    });

    expect(result).toEqual({
      wallet: testWallet.toLowerCase(),
      amount_cents: 100,
      dry_run: true,
    });
  });

  it("parses amount cents from an MPP challenge in dry-run", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await transferCredits({
      options: { "dry-run": true, "mpp-challenge": buildMppChallenge("1000000") },
    });

    expect(result).toEqual({
      wallet: testWallet.toLowerCase(),
      amount_cents: 100,
      dry_run: true,
    });
  });

  it("accepts a PathUSD MPP challenge on Moderato", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await transferCredits({
      options: {
        "dry-run": true,
        network: "testnet",
        "mpp-challenge": buildMppChallenge("1000000", {
          currency: moderatoToken,
          methodDetails: { chainId: 42431 },
        }),
      },
    });

    expect(result).toEqual({
      wallet: testWallet.toLowerCase(),
      amount_cents: 100,
      dry_run: true,
    });
  });

  it("rejects an MPP challenge token that does not match the selected chain", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await transferCredits({
      options: {
        "dry-run": true,
        "mpp-challenge": buildMppChallenge("1000000", { currency: moderatoToken }),
      },
    }).catch((err: unknown) => err);

    expectUsageError(
      error,
      `Invalid configuration: MPP challenge currency ${moderatoToken} does not match token ${usdcToken} for chain 4217`,
    );
  });

  it("throws E_USAGE for a sub-cent MPP challenge amount", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await transferCredits({
      options: { "dry-run": true, "mpp-challenge": buildMppChallenge("15000") },
    }).catch((err: unknown) => err);

    expectUsageError(
      error,
      "Invalid configuration: MPP challenge amount 15000 cannot be represented exactly in Coinflow credits cents for a 6-decimal token",
    );
  });

  it("throws E_USAGE for a non-zero ETH value", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const error = await transferCredits({
      options: {
        "dry-run": true,
        "amount-cents": 100,
        to: recipient,
        value: "1",
      },
    }).catch((err: unknown) => err);

    expectUsageError(
      error,
      "Invalid configuration: Coinflow credits redeem does not support non-zero ETH value",
    );
  });
});
