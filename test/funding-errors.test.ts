import { Errors, Funder, MachineFetch, Policy } from "machine-fetch";
import { describe, expect, it } from "vitest";

import { CtaError } from "../src/cli/incur-compat.js";
import { fundingError } from "../src/payment/funding.js";
import { walletError } from "../src/shared/errors.js";
import { parseNetwork } from "../src/shared/network.js";

const network = parseNetwork("mainnet");
const asset = "0x20c000000000000000000000b9537d11c60e8b50";
const requirement = {
  protocol: "mpp",
  method: "tempo",
  intent: "charge",
  network: "eip155:4217",
  asset,
  amount: 2_000_000n,
} as const;
const context = {
  network,
  requirement,
  policy: { maxPayment: [{ network: "eip155:4217", asset, amount: 1_000_000n }] },
  maxSpendExceeded: (required: bigint) =>
    walletError({ code: "E_LIMIT_EXCEEDED", message: `max spend: ${required}` }),
};

type Row = {
  name: Errors.ErrorType["name"];
  error: Errors.BaseError;
  expected: { code: string; exitCode: number; retryable: boolean };
  cta?: string;
  message?: string;
};

const rows: Row[] = [
  {
    name: "Policy.LimitExceededError",
    error: new Policy.LimitExceededError("Payment exceeds maxPayment"),
    expected: { code: "E_LIMIT_EXCEEDED", exitCode: 4, retryable: false },
    message: "max spend: 2000000",
  },
  {
    name: "Policy.InvalidPaymentError",
    error: new Policy.InvalidPaymentError("Payment amount must be canonical"),
    expected: { code: "E_PAYMENT", exitCode: 4, retryable: false },
  },
  {
    name: "Funder.InsufficientFundsError",
    error: new Funder.InsufficientFundsError("Not enough OUSD"),
    expected: { code: "E_INSUFFICIENT_FUNDS", exitCode: 4, retryable: false },
    cta: "tempo wallet fund --network mainnet",
  },
  {
    name: "Funder.NoRouteError",
    error: new Funder.NoRouteError("No trusted cross-chain route can fund the payment"),
    expected: { code: "E_PAYMENT", exitCode: 4, retryable: false },
  },
  {
    name: "Funder.FundingError",
    error: new Funder.FundingError("Relay quote failed"),
    expected: { code: "E_PAYMENT", exitCode: 4, retryable: false },
  },
  {
    name: "Funder.FundingRecoveryError",
    error: new Funder.FundingRecoveryError("attempt-1"),
    expected: { code: "E_PAYMENT_OUTCOME_UNKNOWN", exitCode: 4, retryable: false },
    message: expect.stringContaining("Funding operation attempt-1 may have moved funds") as never,
    cta: "tempo wallet funding recover attempt-1 --network mainnet",
  },
  {
    name: "Funder.FundingLimitError",
    error: new Funder.FundingLimitError({
      network: "eip155:4217",
      asset: "0x20c000000000000000000000b9537d11c60e8b50",
      required: 51_355n,
      limit: 0n,
    }),
    expected: { code: "E_LIMIT_EXCEEDED", exitCode: 4, retryable: false },
    message: expect.stringContaining("rerun with --max-funding-spend 0.051355") as never,
  },
  {
    name: "Funder.SourceBalanceError",
    error: new Funder.SourceBalanceError({
      network: "eip155:4217",
      asset: "0x20c000000000000000000000b9537d11c60e8b50",
      required: 1_269_134n,
      held: 47_740n,
    }),
    expected: { code: "E_INSUFFICIENT_FUNDS", exitCode: 4, retryable: false },
    message: expect.stringContaining("needs 1.269134 USDC.e") as never,
    cta: "tempo wallet fund --network mainnet",
  },
  {
    name: "Errors.OperationStoreError",
    error: new Errors.OperationStoreError("disk full"),
    expected: { code: "E_RUNTIME", exitCode: 1, retryable: false },
  },
  {
    name: "Errors.InvalidConfigurationError",
    error: new Errors.InvalidConfigurationError("bad"),
    expected: { code: "E_RUNTIME", exitCode: 1, retryable: false },
  },
  {
    name: "MachineFetch.DisposedError",
    error: new MachineFetch.DisposedError("disposed"),
    expected: { code: "E_RUNTIME", exitCode: 1, retryable: false },
  },
];

describe("machine-fetch error mapping", () => {
  it("covers every machine-fetch error class", () => {
    const names: Record<Errors.ErrorType["name"], true> = {
      "MachineFetch.DisposedError": true,
      "Errors.InvalidConfigurationError": true,
      "Policy.InvalidPaymentError": true,
      "Policy.LimitExceededError": true,
      "Funder.FundingError": true,
      "Funder.NoRouteError": true,
      "Funder.InsufficientFundsError": true,
      "Funder.FundingRecoveryError": true,
      "Funder.FundingLimitError": true,
      "Funder.SourceBalanceError": true,
      "Errors.OperationStoreError": true,
    };
    expect(rows.map((row) => row.name).sort()).toEqual(Object.keys(names).sort());
    for (const row of rows) expect(row.error.name).toBe(row.name);
  });

  it.each(rows)("maps $name to $expected.code", ({ error, expected, cta, message }) => {
    const mapped = fundingError(error, context);
    expect(mapped).toMatchObject({ ...expected, ...(message ? { message } : {}) });
    if (cta) {
      expect(mapped).toBeInstanceOf(CtaError);
      expect((mapped as CtaError).payload.cta).toEqual({ commands: [{ command: cta }] });
    } else expect(mapped).not.toBeInstanceOf(CtaError);
  });

  it("refuses a payment in a token without a limit without the max-spend rerun", () => {
    const mapped = fundingError(
      new Policy.LimitExceededError("Payment asset has no maxPayment limit"),
      {
        ...context,
        requirement: { ...requirement, asset: "0x20c000000000000000000000000000000000beef" },
      },
    );
    expect(mapped).toMatchObject({
      code: "E_LIMIT_EXCEEDED",
      message:
        "--max-spend cannot cap a payment in 0x20c000000000000000000000000000000000beef on mainnet: it is not a USD token the CLI lists, so it was not paid",
    });
  });

  it("passes other errors through unchanged", () => {
    const error = new Error("boom");
    expect(fundingError(error, context)).toBe(error);
  });
});
