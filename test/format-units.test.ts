import { describe, expect, it } from "vitest";

import { formatCreditBalance, formatTokenUnits } from "../src/shared/utils.js";

describe("formatTokenUnits", () => {
  it("formats non-negative values", () => {
    expect(formatTokenUnits(0n, 6)).toBe("0.000000");
    expect(formatTokenUnits(1_000_000n, 6)).toBe("1.000000");
    expect(formatTokenUnits(1_234_567n, 6)).toBe("1.234567");
    expect(formatTokenUnits(42n, 0)).toBe("42");
  });

  it("keeps the sign outside padded fractional digits for negative values", () => {
    expect(formatTokenUnits(-5n, 6)).toBe("-0.000005");
    expect(formatTokenUnits(-1_234_567n, 6)).toBe("-1.234567");
    expect(formatTokenUnits(-42n, 0)).toBe("-42");
  });
});

describe("formatCreditBalance", () => {
  it("formats non-negative credit balances", () => {
    expect(formatCreditBalance(0n)).toBe("0");
    expect(formatCreditBalance(10_000n)).toBe("1");
    expect(formatCreditBalance(12_345n)).toBe("1.2345");
  });

  it("keeps the sign outside padded fractional digits for negative balances", () => {
    expect(formatCreditBalance(-5n)).toBe("-0.0005");
    expect(formatCreditBalance(-12_345n)).toBe("-1.2345");
  });
});
