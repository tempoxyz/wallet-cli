import {
  FundingError,
  FundingRecoveryError,
  InsufficientFundsError,
  MachineFetchError,
  type MachineFetchErrorCode,
  NoRouteError,
  OperationStoreError,
  PaymentPolicyError,
} from "machine-fetch";
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
  code: MachineFetchErrorCode;
  error: MachineFetchError;
  expected: { code: string; exitCode: number; retryable: boolean };
  cta?: string;
  message?: string;
};

const rows: Row[] = [
  {
    code: "LIMIT_EXCEEDED",
    error: new PaymentPolicyError("Payment exceeds maxPayment", { code: "LIMIT_EXCEEDED" }),
    expected: { code: "E_LIMIT_EXCEEDED", exitCode: 4, retryable: false },
    message: "max spend: 2000000",
  },
  {
    code: "INVALID_PAYMENT",
    error: new PaymentPolicyError("Payment amount must be canonical", { code: "INVALID_PAYMENT" }),
    expected: { code: "E_PAYMENT", exitCode: 4, retryable: false },
  },
  {
    code: "INSUFFICIENT_FUNDS",
    error: new InsufficientFundsError("Not enough OUSD"),
    expected: { code: "E_INSUFFICIENT_FUNDS", exitCode: 4, retryable: false },
    cta: "tempo wallet fund --network mainnet",
  },
  {
    code: "NO_ROUTE",
    error: new NoRouteError("No trusted cross-chain route can fund the payment"),
    expected: { code: "E_PAYMENT", exitCode: 4, retryable: false },
  },
  {
    code: "FUNDING_FAILED",
    error: new FundingError("Relay quote failed"),
    expected: { code: "E_PAYMENT", exitCode: 4, retryable: false },
  },
  {
    code: "RECOVERY_REQUIRED",
    error: new FundingRecoveryError("attempt-1"),
    expected: { code: "E_PAYMENT_OUTCOME_UNKNOWN", exitCode: 4, retryable: false },
    message: expect.stringContaining("Funding operation attempt-1 may have moved funds") as never,
    cta: "tempo wallet funding recover attempt-1 --network mainnet",
  },
  {
    code: "STORE_FAILED",
    error: new OperationStoreError("disk full"),
    expected: { code: "E_RUNTIME", exitCode: 1, retryable: false },
  },
  {
    code: "INVALID_CONFIGURATION",
    error: new FundingError("bad", { code: "INVALID_CONFIGURATION" }),
    expected: { code: "E_RUNTIME", exitCode: 1, retryable: false },
  },
  {
    code: "DISPOSED",
    error: new MachineFetchError("disposed", { code: "DISPOSED" }),
    expected: { code: "E_RUNTIME", exitCode: 1, retryable: false },
  },
];

describe("machine-fetch error mapping", () => {
  it("covers every machine-fetch error code", () => {
    const codes: Record<MachineFetchErrorCode, true> = {
      DISPOSED: true,
      INVALID_CONFIGURATION: true,
      INVALID_PAYMENT: true,
      LIMIT_EXCEEDED: true,
      FUNDING_FAILED: true,
      NO_ROUTE: true,
      INSUFFICIENT_FUNDS: true,
      RECOVERY_REQUIRED: true,
      STORE_FAILED: true,
    };
    expect(rows.map((row) => row.code).sort()).toEqual(Object.keys(codes).sort());
  });

  it.each(rows)("maps $code to $expected.code", ({ error, expected, cta, message }) => {
    const mapped = fundingError(error, context);
    expect(mapped).toMatchObject({ ...expected, ...(message ? { message } : {}) });
    if (cta) {
      expect(mapped).toBeInstanceOf(CtaError);
      expect((mapped as CtaError).payload.cta).toEqual({ commands: [{ command: cta }] });
    } else expect(mapped).not.toBeInstanceOf(CtaError);
  });

  it("refuses a payment in a token without a limit without the max-spend rerun", () => {
    const mapped = fundingError(
      new PaymentPolicyError("Payment asset has no maxPayment limit", { code: "LIMIT_EXCEEDED" }),
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
