import { execFile } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadPendingLogin, loadWalletState } from "../src/wallet/store.js";
import { cliBundle } from "./cli-bundle.js";
import { deviceCodeHost, type TokenAnswer } from "./device-code-host.js";
import { testWallet, useTempHome } from "./helpers.js";

const interactiveStdout = join(import.meta.dirname, "fixtures", "interactive-stdout.mjs");

describe("tempo wallet login", () => {
  it.each([
    { name: "an agent run returns the code at once", argv: [], interactive: false, waits: false },
    { name: "a terminal run waits for approval", argv: [], interactive: true, waits: true },
    {
      name: "--no-wait returns at once in a terminal",
      argv: ["--no-wait"],
      interactive: true,
      waits: false,
    },
    { name: "--wait makes an agent run wait", argv: ["--wait"], interactive: false, waits: true },
  ])("$name", async ({ argv, interactive, waits }) => {
    await useTempHome();
    const result = await withHost(["pending", "approve"], (url) =>
      wallet(["login", "--no-browser", "-n", "testnet", ...argv], url, { interactive }),
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain("Device confirmation code: ABCD-EFG1");
    expect(result.stderr).toContain(
      `Continue at: ${result.url}/api/auth/device/verify?user_code=ABCDEFG1`,
    );
    expect(result.stderr.includes("Waiting for approval")).toBe(waits);
    expect(result.polls).toBe(waits ? 2 : 0);
    expect(result.stdout).toContain(waits ? testWallet.toLowerCase() : "ABCD-EFG1");
    expect(Boolean(await loadPendingLogin())).toBe(!waits);
    expect((await loadWalletState()).accounts).toEqual(waits ? [{ address: testWallet }] : []);
  });

  it("finishes in a later process with login status", async () => {
    await useTempHome();
    const { login, status } = await withHost(["pending", "approve"], async (url) => ({
      login: await wallet(["login", "--no-browser", "-n", "testnet"], url),
      status: await wallet(["login", "status", "-n", "testnet"], url),
    }));

    expect(login.code, login.stderr).toBe(0);
    expect(JSON.parse(login.stdout)).toMatchObject({
      status: "pending",
      user_code: "ABCD-EFG1",
      _next: { command: "tempo wallet login status --interval 1 --network testnet" },
    });
    expect(status.code, status.stderr).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      accounts: [testWallet.toLowerCase()],
      chain_id: 42431,
      network: "tempo-moderato",
    });
    expect((await loadWalletState()).accounts).toEqual([{ address: testWallet }]);
  });

  it.each([
    {
      name: "out of attempts",
      start: true,
      exitCode: 3,
      error: {
        code: "E_POLL_TIMEOUT",
        retryable: true,
        cta: {
          commands: [{ command: "tempo wallet login status --max-attempts 1 --network testnet" }],
        },
      },
    },
    {
      name: "without a pending login",
      start: false,
      exitCode: 2,
      error: {
        code: "E_USAGE",
        retryable: false,
        cta: { commands: [{ command: "tempo wallet login --network testnet" }] },
      },
    },
  ])("login status reports $name with its next command", async ({ start, exitCode, error }) => {
    await useTempHome();
    const status = await withHost(["pending"], async (url) => {
      if (start) await wallet(["login", "--no-browser", "-n", "testnet"], url);
      return await wallet(["login", "status", "--max-attempts", "1", "-n", "testnet"], url);
    });

    expect(status.code, status.stderr).toBe(exitCode);
    expect(JSON.parse(status.stdout)).toMatchObject(error);
  });
});

/** Runs `run` against a device-code host serving `answers`, reporting its `/token` polls. */
async function withHost<result extends object>(
  answers: readonly TokenAnswer[],
  run: (url: string) => Promise<result>,
) {
  const host = deviceCodeHost((poll) => answers[Math.min(poll, answers.length) - 1]!);
  const server = await host.listen();
  try {
    const result = await run(server.url);
    return { ...result, polls: host.polls.length, url: server.url };
  } finally {
    await server.close();
  }
}

/** Runs the wallet CLI as an agent (`--format json`), or with `interactive` as a terminal user. */
function wallet(args: string[], authUrl: string, { interactive = false } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", TEMPO_AUTH_URL: authUrl };
  delete env.TEMPO_WALLET_NETWORK;
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      interactive
        ? ["--import", interactiveStdout, cliBundle("wallet"), ...args]
        : [cliBundle("wallet"), ...args, "--format", "json"],
      { env, timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      },
    );
  });
}
