import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runFundingFlow: vi.fn().mockResolvedValue({ status: "success" }),
}));

vi.mock("../src/commands/fund.js", async (importOriginal) => ({
  ...(await importOriginal()),
  runFundingFlow: mocks.runFundingFlow,
}));

import { handleCompatCommand, validateFundCompatArgs } from "../src/compat.js";
import { networkError, walletError } from "../src/shared/errors.js";

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

  it.each([
    {
      thrown: new Error("RPC down"),
      exitCode: 1,
      printed: { code: "E_RUNTIME", message: "RPC down", retryable: false },
    },
    {
      thrown: networkError("socket hang up", { retryable: true }),
      exitCode: 3,
      printed: { code: "E_NETWORK", message: "socket hang up", retryable: true },
    },
    {
      thrown: walletError({ code: "E_POLL_TIMEOUT", message: "Timed out", retryable: false }),
      exitCode: 3,
      printed: { code: "E_POLL_TIMEOUT", message: "Timed out", retryable: false },
    },
  ])("prints $printed.code JSON errors with retryable", async ({ thrown, exitCode, printed }) => {
    mocks.runFundingFlow.mockRejectedValueOnce(thrown);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });

    await expect(handleCompatCommand(["fund", "--no-browser", "--json-output"])).rejects.toThrow(
      `exit ${exitCode}`,
    );
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(printed);
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
