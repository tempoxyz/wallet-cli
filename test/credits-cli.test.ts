import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cliBundle } from "./cli-bundle.js";

import { testWallet, useTempHome, walletState, writeWalletState } from "./helpers.js";
import { usdcToken } from "../src/shared/constants.js";
import { appUrl } from "../src/shared/network.js";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const recipient = "0x1111111111111111111111111111111111111111";

async function cli(args: string[]) {
  try {
    return {
      code: 0,
      ...(await exec(process.execPath, [cliBundle("wallet"), ...args, "--format", "json"], {
        cwd: root,
        env: { ...process.env, NO_COLOR: "1" },
      })),
    };
  } catch (error) {
    return error as { code: number; stdout: string; stderr: string };
  }
}

describe("credits CLI compatibility", () => {
  it.each([[], ["--mach"], ["--crypto"], ["--referral-code", "CODE"]].map((flags) => ({ flags })))(
    "rejects credit funding even with %j and without login",
    async ({ flags }) => {
      await useTempHome();
      const result = await cli(["fund", "--credits", ...flags]);
      expect(result.code).toBe(2);
      expect(result.stdout + result.stderr).toContain("MPP Credits can no longer be purchased");
      expect(result.stdout + result.stderr).toContain("tempo wallet fund --mach");
      expect(result.stdout + result.stderr).not.toContain(new URL("/agent", appUrl).toString());
    },
  );

  it("routes --credits to legacy spending and warns only on stderr", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const result = await cli([
      "transfer",
      "--credits",
      "--amount-cents",
      "100",
      "--to",
      recipient,
      "--dry-run",
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      wallet: testWallet.toLowerCase(),
      amount_cents: 100,
      dry_run: true,
    });
    expect(result.stderr.match(/--credits is deprecated/g)).toHaveLength(1);
    expect(result.stderr).toContain("tempo wallet fund --mach");
  });

  it("keeps MACH and credits distinct for the same machine-enabled challenge file", async () => {
    const home = await useTempHome();
    await writeWalletState(walletState());
    const file = resolve(home, "challenge.txt");
    const request = Buffer.from(
      JSON.stringify({
        amount: "1000000",
        currency: usdcToken,
        recipient,
        methodDetails: { chainId: 4217, machineTokenEnabled: true },
      }),
    ).toString("base64url");
    await writeFile(
      file,
      `WWW-Authenticate: Payment realm="example", method="tempo", intent="charge", id="abc123", expires="2099-01-01T00:00:00Z", request="${request}"`,
    );
    const credits = await cli(["transfer", "--credits", "--mpp-challenge-file", file, "--dry-run"]);
    expect(credits.code).toBe(0);
    expect(JSON.parse(credits.stdout)).toMatchObject({ amount_cents: 100, dry_run: true });
    expect(credits.stderr).toContain("--credits is deprecated");
    const mach = await cli(["transfer", "--mach", "--mpp-challenge-file", file, "--dry-run"]);
    expect(mach.code).toBe(0);
    expect(JSON.parse(mach.stdout)).toMatchObject({
      token: "MACH",
      amount_raw: "1000000",
      dry_run: true,
    });
    expect(mach.stderr).not.toContain("--credits is deprecated");
  });

  it("rejects simultaneous spending selectors", async () => {
    await useTempHome();
    const result = await cli(["transfer", "--credits", "--mach", "--dry-run"]);
    expect(result.code).toBe(2);
    expect(result.stdout + result.stderr).toContain("Use only one of --credits and --mach");
  });

  it.each([["1"], ["1", usdcToken], ["1", usdcToken, recipient]])(
    "rejects positional transfer arguments with credits: %j",
    async (...args) => {
      await useTempHome();
      const result = await cli(["transfer", ...args, "--credits", "--mpp-challenge", "ignored"]);
      expect(result.code).toBe(2);
      expect(result.stdout + result.stderr).toContain("Positional amount, token, and recipient");
    },
  );
});
