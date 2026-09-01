import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runFundingFlow: vi.fn().mockResolvedValue({ status: "success" }),
}));

vi.mock("../src/commands/fund.js", async (importOriginal) => ({
  ...(await importOriginal()),
  runFundingFlow: mocks.runFundingFlow,
}));

import { handleCompatCommand, validateFundCompatArgs } from "../src/compat.js";

describe("fund compatibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.runFundingFlow.mockClear();
  });

  it.each(["--network", "-n"])("forwards %s to the funding flow", async (flag) => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(handleCompatCommand(["fund", flag, "testnet", "--no-browser"])).resolves.toBe(
      true,
    );
    expect(mocks.runFundingFlow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fund", network: "testnet" }),
    );
  });

  it("forwards equals-form options to the funding flow", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(handleCompatCommand(["fund", "--network=testnet", "--no-browser"])).resolves.toBe(
      true,
    );
    expect(mocks.runFundingFlow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fund", network: "testnet" }),
    );
  });

  it("rejects unknown options before starting a funding flow", () => {
    expect(() => validateFundCompatArgs(["fund", "--not-a-real-option"])).toThrow(
      "Unknown option: --not-a-real-option",
    );
  });

  it("rejects unknown options before the fund command", () => {
    expect(() => validateFundCompatArgs(["--not-a-real-option", "fund", "--no-browser"])).toThrow(
      "Unknown option: --not-a-real-option",
    );
  });

  it("accepts equals-form value options", () => {
    expect(() =>
      validateFundCompatArgs(["fund", "--format=json", "--token-limit=10"]),
    ).not.toThrow();
  });
});
