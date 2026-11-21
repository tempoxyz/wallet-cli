import { encodeFunctionData, type Hex } from "viem";
import { Abis } from "viem/tempo";
import { describe, expect, it } from "vitest";

import {
  assertCanFund,
  assertKeyCanFund,
  spendableAmount,
  spentByCalls,
} from "../src/request/funding.js";
import { feeFundedTopUp, topUpAmount } from "../src/request/session-topup.js";
import type { Network } from "../src/shared/network.js";

const token = "0x20c000000000000000000000b9537d11c60e8b50";
const other = "0x20c0000000000000000000000000000000000001";
const recipient = "0x1111111111111111111111111111111111111111";
const wallet = { address: recipient, signerAddress: recipient } as never;
const keyed = {
  address: recipient,
  signerAddress: "0x2222222222222222222222222222222222222222",
  key: { address: "0x2222222222222222222222222222222222222222" },
} as never;
const network: Network = { name: "mainnet", chainId: 4217 };

describe("topUpAmount", () => {
  it.each([
    {
      name: "doubles the deposit under the default cap",
      deposit: 1_000_000n,
      required: 5_000n,
      expected: 1_000_000n,
    },
    {
      name: "keeps a shortfall larger than the deposit",
      deposit: 1_000n,
      required: 5_000n,
      expected: 5_000n,
    },
    {
      name: "takes an explicit cap's headroom",
      deposit: 1_000_000n,
      required: 5_000n,
      explicitCap: true,
      cap: 4_000_000n,
      expected: 3_000_000n,
    },
    {
      name: "takes a larger server suggestion",
      deposit: 1_000_000n,
      required: 5_000n,
      suggestedDeposit: 2_500_000n,
      expected: 2_500_000n,
    },
    { name: "stops at the cap", deposit: 8_000_000n, required: 5_000n, expected: 2_000_000n },
    {
      name: "stops at what the wallet can spend",
      deposit: 1_000_000n,
      required: 5_000n,
      available: 300_000n,
      expected: 300_000n,
    },
    {
      name: "never goes below the shortfall",
      deposit: 1_000_000n,
      required: 5_000n,
      available: 1_000n,
      expected: 5_000n,
    },
    {
      name: "leaves a shortfall past the cap to the refusal",
      deposit: 9_000_000n,
      required: 2_000_000n,
      expected: 2_000_000n,
    },
  ])("$name", ({ cap = 10_000_000n, explicitCap = false, expected, ...rest }) => {
    expect(topUpAmount({ cap, explicitCap, ...rest })).toBe(expected);
  });
});

describe("spentByCalls", () => {
  const transfer = (amount: bigint) =>
    encodeFunctionData({ abi: Abis.tip20, functionName: "transfer", args: [recipient, amount] });
  it("sums the first call's token transfers", () => {
    expect(
      spentByCalls([
        { to: token, data: transfer(3n) },
        { to: token, data: transfer(4n) },
        { to: other, data: transfer(100n) },
      ]),
    ).toEqual({ token, amount: 7n });
  });
  it("reads an approval, as on the MACH route", () => {
    const data = encodeFunctionData({
      abi: Abis.tip20,
      functionName: "approve",
      args: [recipient, 9n],
    });
    expect(
      spentByCalls([
        { to: token, data },
        { to: other, data: "0x" as Hex },
      ]),
    ).toEqual({
      token,
      amount: 9n,
    });
  });
  it("ignores calls that spend nothing it can read", () => {
    expect(spentByCalls([{ to: token, data: "0x" as Hex }])).toBeUndefined();
    expect(spentByCalls([])).toBeUndefined();
  });
});

describe("assertCanFund", () => {
  const check = (identity: never, allowance: object, balance: bigint, amount = 500n) =>
    assertCanFund(identity, {
      amount,
      capacity: { allowance: allowance as never, balance },
      network,
      purpose: "session top-up",
      token,
    });
  it("refuses an amount above the key's remaining limit with the key-limit error", () => {
    expect(() => check(keyed, { kind: "limited", remaining: 100n }, 10_000n)).toThrow(
      expect.objectContaining({ code: "E_LIMIT_EXCEEDED" }),
    );
  });
  it("refuses a revoked or expired key", () => {
    expect(() => check(keyed, { kind: "unusable" }, 10_000n)).toThrow(/revoked, expired/);
  });
  it("refuses an amount above the balance", () => {
    expect(() => check(wallet, { kind: "unlimited" }, 100n)).toThrow(
      "Insufficient balance for session top-up: available=0.0001 required=0.0005",
    );
  });
  it.each([
    { allowance: { kind: "limited", remaining: 500n }, balance: 500n },
    { allowance: { kind: "unknown" }, balance: 500n },
    { allowance: { kind: "unlimited" }, balance: 10_000n },
  ])("allows a fundable amount ($allowance.kind)", ({ allowance, balance }) => {
    expect(() => check(keyed, allowance, balance)).not.toThrow();
  });
});

describe("spendableAmount", () => {
  it.each([
    { allowance: { kind: "limited", remaining: 100n }, balance: 500n, expected: 100n },
    { allowance: { kind: "limited", remaining: 900n }, balance: 500n, expected: 500n },
    { allowance: { kind: "unlimited" }, balance: 500n, expected: 500n },
    { allowance: { kind: "unknown" }, balance: 500n, expected: 500n },
    { allowance: { kind: "unusable" }, balance: 500n, expected: 0n },
  ])("$allowance.kind", ({ allowance, balance, expected }) => {
    expect(spendableAmount({ allowance: allowance as never, balance })).toBe(expected);
  });
});

describe("assertKeyCanFund", () => {
  const check = (allowance: object) =>
    assertKeyCanFund(keyed, {
      allowance: allowance as never,
      amount: 500n,
      network,
      purpose: "payment",
      token,
    });
  it("refuses a limit below the amount or an unusable key", () => {
    expect(() => check({ kind: "limited", remaining: 100n })).toThrow(
      expect.objectContaining({ code: "E_LIMIT_EXCEEDED" }),
    );
    expect(() => check({ kind: "unusable" })).toThrow(/revoked, expired/);
  });
  it.each([{ kind: "limited", remaining: 500n }, { kind: "unknown" }, { kind: "unlimited" }])(
    "leaves the balance unchecked ($kind)",
    (allowance) => {
      expect(() => check(allowance)).not.toThrow();
    },
  );
});

describe("feeFundedTopUp", () => {
  // 100_000 gas at 2e7 attodollars per gas costs 2 base units of a 6-decimal fee token.
  const priced = { gas: 100_000n, maxFeePerGas: 20_000_000n };
  const unsponsored = { feePayer: false, token };
  it.each([
    {
      name: "leaves the fee in a balance the chunk would use up",
      balance: 300_000n,
      expected: 299_998n,
    },
    {
      name: "keeps a chunk the balance covers with the fee",
      balance: 1_000_000n,
      expected: 300_000n,
    },
    { name: "never goes below the shortfall", balance: 5_001n, expected: 5_000n },
    {
      name: "keeps a sponsored chunk",
      details: { feePayer: true, token },
      balance: 300_000n,
      expected: 300_000n,
    },
    {
      name: "keeps a chunk whose fee another token pays",
      details: { feePayer: false, feeToken: other, token },
      balance: 300_000n,
      expected: 300_000n,
    },
    {
      name: "lowers an unpriced fee's top-up to the shortfall",
      prepared: { gas: 100_000n },
      balance: 300_000n,
      expected: 5_000n,
    },
  ])("$name", ({ details = unsponsored, prepared = priced, balance, expected }) => {
    expect(
      feeFundedTopUp({ additionalDeposit: 300_000n, balance, details, prepared, required: 5_000n }),
    ).toBe(expected);
  });
});
