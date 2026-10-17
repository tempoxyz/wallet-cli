import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Errors } from "incur";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseRequestArgs } from "../src/request/args.js";
import { executeRequest } from "../src/request/run.js";
import { requireSessionDescriptor } from "../src/payment/session-descriptor.js";
import { withFileLock } from "../src/payment/session-lock.js";
import { commandMap } from "../src/cli/command.js";
import { ctaErrors } from "../src/cli/incur-compat.js";
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
import { channelsDbPath, runSql } from "../src/shared/process.js";
import { walletProblem, WalletRequiredError } from "../src/shared/require-wallet.js";
import { accessKeyLimitError } from "../src/wallet/access-key.js";
import { useTempHome } from "./helpers.js";

const root = resolve(import.meta.dirname, "..");
const key = "0x4cdadb819a7fc083b72ada08288a96424f34c8a0";
const token = "0x20c0000000000000000000000000000000000000";

describe("errorCodes", () => {
  const expected: [WalletErrorCode, number, boolean][] = [
    ["E_AUTH_REFRESH_REQUIRED", 4, false],
    ["E_HTTP", 3, false],
    ["E_INSUFFICIENT_FUNDS", 4, false],
    ["E_KEY_EXPIRED", 4, false],
    ["E_LIMIT_EXCEEDED", 4, false],
    ["E_LOGIN_DENIED", 4, false],
    ["E_LOGIN_EXPIRED", 4, false],
    ["E_NETWORK", 3, false],
    ["E_NOT_AUTHENTICATED", 4, false],
    ["E_NOT_FOUND", 2, false],
    ["E_PAYMENT", 4, false],
    ["E_PAYMENT_OUTCOME_UNKNOWN", 4, false],
    ["E_POLL_TIMEOUT", 3, true],
    ["E_RPC", 3, false],
    ["E_RUNTIME", 1, false],
    ["E_USAGE", 2, false],
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

describe("CtaError", () => {
  const network = { name: "testnet", chainId: 42431 } as const;
  const command = `tempo wallet keys update ${key} --token ${token} --limit 1.5 --network testnet`;

  it("builds the keys update for an access key limit, lowercasing the key", () => {
    const error = accessKeyLimitError({
      key: key.toUpperCase().replace("0X", "0x"),
      token,
      label: "pathUSD",
      amount: "1.5",
      network,
    });

    const fields = {
      code: "E_LIMIT_EXCEEDED",
      message: `The access key cannot spend 1.5 pathUSD. Ask the wallet owner to run '${command}', then retry.`,
      exitCode: 4,
      retryable: false,
    };
    expect(error).toBeInstanceOf(Errors.IncurError);
    expect(error).toMatchObject(fields);
    expect(error.payload).toEqual({ ...fields, cta: { commands: [{ command }] } });
  });

  const refusal = accessKeyLimitError({ key, token, label: "pathUSD", amount: "1.5", network });
  it.each([
    { name: "a CtaError through c.error", thrown: refusal, returned: refusal.payload },
    { name: "a value without calling c.error", returned: undefined },
  ])("middleware returns $name", async ({ thrown, returned }) => {
    const error = vi.fn();

    await ctaErrors({ error: error as never }, async () => {
      if (thrown) throw thrown;
    });

    if (returned) expect(error).toHaveBeenCalledExactlyOnceWith(returned);
    else expect(error).not.toHaveBeenCalled();
  });

  it.each([usageError("bad input"), new Error("boom")])(
    "middleware rethrows other errors: %s",
    async (thrown) => {
      const error = vi.fn();

      await expect(
        ctaErrors({ error: error as never }, async () => {
          throw thrown;
        }),
      ).rejects.toBe(thrown);
      expect(error).not.toHaveBeenCalled();
    },
  );
});

/**
 * Starts a temporary HOME whose PATH has only a `sqlite3` that runs `script`, or one that cannot
 * start without it.
 */
async function fakeSqlite3(script?: string) {
  const home = await useTempHome();
  const bin = join(home, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "sqlite3"), script ? `#!/bin/sh\n${script}\n` : "", {
    mode: script ? 0o755 : 0o644,
  });
  vi.stubEnv("PATH", bin);
  return home;
}

describe("typed error sites", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each<{
    site: string;
    code: WalletErrorCode;
    message: unknown;
    retryable?: boolean;
    run: () => Promise<unknown>;
  }>([
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
    {
      site: "command map of a value incur did not create",
      code: "E_RUNTIME",
      message: "Unable to access wallet commands",
      run: async () => commandMap({} as never),
    },
    {
      site: "a file lock sqlite3 cannot take",
      code: "E_RUNTIME",
      message: expect.stringMatching(/^sqlite3 failed to lock .+: .*file is not a database/),
      run: async () => {
        const lock = join(await useTempHome(), "test.lock");
        await writeFile(lock, "not a database");
        return withFileLock(lock, "test lock", async () => undefined);
      },
    },
    {
      site: "a file lock whose sqlite3 cannot start",
      code: "E_RUNTIME",
      message: expect.stringMatching(
        /^Failed to run sqlite3 for the lock at .+: spawn sqlite3 EACCES$/,
      ),
      run: async () => {
        const home = await fakeSqlite3();
        return withFileLock(join(home, "test.lock"), "test lock", async () => undefined);
      },
    },
    {
      site: "a session store sqlite3 cannot read",
      code: "E_RUNTIME",
      message: expect.stringMatching(/file is not a database/),
      run: async () => {
        await useTempHome();
        await writeFile(channelsDbPath(), "not a database");
        return runSql("SELECT name FROM sqlite_master");
      },
    },
    {
      site: "a session store another process holds past the busy timeout",
      code: "E_RUNTIME",
      message: "Error: in prepare, database is locked (5)\n",
      retryable: true,
      run: async () => {
        await fakeSqlite3("echo 'Error: in prepare, database is locked (5)' >&2; exit 5");
        return runSql("SELECT name FROM sqlite_master");
      },
    },
  ])("$site throws $code", async ({ code, message, retryable, run }) => {
    await expect(run()).rejects.toMatchObject({
      code,
      exitCode: errorCodes[code].exitCode,
      retryable: retryable ?? errorCodes[code].retryable,
      message,
    });
  });

  // Bare `Error` throws and rejections allowed under src/, as `src/<file>: <trimmed line text>` and
  // a one-line reason: a programmer-error assertion no user can reach, or an upstream API that needs
  // a plain `Error`. Keyed by text so edits that shift lines keep matching; list a repeated line
  // once per occurrence.
  const allowedBareErrors: [site: string, reason: string][] = [];
  const bareError = /\b(throw\s+|reject\(\s*)(new\s+)?Error\(/;

  it.each([
    ["throw new Error(message);", true],
    ["throw Error(message);", true],
    ["else reject(new Error(message));", true],
    ["return Promise.reject(new Error(message));", true],
    ["throw walletError({ code, message });", false],
    ["reject(walletError({ code, message }));", false],
    ["controller.abort(new Error(message));", false],
  ])("treats %s as a bare Error: %s", (line, bare) => {
    expect(bareError.test(line)).toBe(bare);
  });

  it("throws and rejects typed errors instead of bare Error", async () => {
    const found: string[] = [];
    for (const file of await readdir(join(root, "src"), { recursive: true })) {
      if (!file.endsWith(".ts")) continue;
      const source = await readFile(join(root, "src", file), "utf8");
      for (const line of source.split("\n"))
        if (bareError.test(line)) found.push(`src/${file}: ${line.trim()}`);
    }
    expect(found.sort()).toEqual(allowedBareErrors.map(([site]) => site).sort());
  });
});
