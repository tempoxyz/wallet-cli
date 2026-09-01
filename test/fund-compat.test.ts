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

  it("rejects unknown options before starting a funding flow", () => {
    expect(() => validateFundCompatArgs(["fund", "--not-a-real-option"])).toThrow(
      "Unknown option: --not-a-real-option",
    );
  });
});
