import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { executeRequest, parseRequestArgs } from "../src/commands/request.js";
import { requireSessionDescriptor } from "../src/payment/session-descriptor.js";
import {
  errorCodes,
  httpError,
  networkError,
  paymentError,
  paymentOutcomeUnknownError,
  usageError,
  walletError,
  type WalletErrorCode,
} from "../src/shared/errors.js";
import { walletProblem, WalletRequiredError } from "../src/shared/require-wallet.js";

const root = resolve(import.meta.dirname, "..");

describe("errorCodes", () => {
  const expected: [WalletErrorCode, number, boolean][] = [
    ["E_USAGE", 2, false],
    ["E_NOT_FOUND", 2, false],
    ["E_NETWORK", 3, false],
    ["E_HTTP", 3, false],
    ["E_RPC", 3, false],
    ["E_POLL_TIMEOUT", 3, true],
    ["E_PAYMENT", 4, false],
    ["E_PAYMENT_OUTCOME_UNKNOWN", 4, false],
    ["E_NOT_AUTHENTICATED", 4, false],
    ["E_LOGIN_DENIED", 4, false],
    ["E_LOGIN_EXPIRED", 4, false],
    ["E_AUTH_REFRESH_REQUIRED", 4, false],
    ["E_KEY_EXPIRED", 4, false],
    ["E_LIMIT_EXCEEDED", 4, false],
    ["E_INSUFFICIENT_FUNDS", 4, false],
    ["E_RUNTIME", 1, false],
  ];

  it("lists every code", () => {
    expect(Object.keys(errorCodes)).toEqual(expected.map(([code]) => code));
  });

  it.each(expected)("%s exits %i with retryable=%s", (code, exitCode, retryable) => {
    expect(errorCodes[code]).toMatchObject({ exitCode, retryable });
    expect(errorCodes[code].description).toMatch(/^[A-Z][^\n]{0,78}\.$/);
    expect(walletError({ code, message: "failed" })).toMatchObject({
      code,
      exitCode,
      retryable,
      message: "failed",
    });
  });

  it("lets callers override retryable and attach a cause", () => {
    const cause = new Error("socket hang up");
    expect(
      walletError({ code: "E_NETWORK", message: "fetch failed", retryable: true, cause }),
    ).toMatchObject({ code: "E_NETWORK", exitCode: 3, retryable: true, cause });
  });

  it.each([
    ["usageError", usageError("bad input"), "E_USAGE"],
    ["networkError", networkError("offline"), "E_NETWORK"],
    ["httpError", httpError(502), "E_HTTP"],
    ["paymentError", paymentError("rejected"), "E_PAYMENT"],
    [
      "paymentOutcomeUnknownError",
      paymentOutcomeUnknownError("maybe"),
      "E_PAYMENT_OUTCOME_UNKNOWN",
    ],
    [
      "WalletRequiredError",
      new WalletRequiredError(walletProblem("E_KEY_EXPIRED", { name: "testnet", chainId: 42431 })),
      "E_KEY_EXPIRED",
    ],
  ] as const)("%s builds %s", (_name, error, code) => {
    expect(error).toMatchObject({
      code,
      exitCode: errorCodes[code].exitCode,
      retryable: errorCodes[code].retryable,
    });
  });
});

describe("typed error sites", () => {
  it.each([
    {
      site: "request --json with invalid JSON",
      code: "E_USAGE",
      message: expect.stringMatching(/^Invalid JSON passed to --json: /),
      run: () => executeRequest(parseRequestArgs(["--json", "{bad", "http://127.0.0.1:9/"])),
    },
    {
      site: "v2 session without a stored descriptor",
      code: "E_NOT_FOUND",
      message: "v2 session management requires a stored channel descriptor",
      run: async () => requireSessionDescriptor({}),
    },
  ] as const)("$site throws $code", async ({ code, message, run }) => {
    await expect(run()).rejects.toMatchObject({
      code,
      exitCode: errorCodes[code].exitCode,
      message,
    });
  });

  it("throws typed errors instead of bare Error", async () => {
    const found: string[] = [];
    for (const dir of ["src/commands", "src/payment", "src/shared"])
      for (const file of await readdir(join(root, dir), { recursive: true })) {
        if (!file.endsWith(".ts")) continue;
        const source = await readFile(join(root, dir, file), "utf8");
        for (const line of source.split("\n"))
          if (/\bthrow\s+(new\s+)?Error\(/.test(line)) found.push(`${dir}/${file}: ${line.trim()}`);
      }
    expect(found).toEqual([]);
  });
});
