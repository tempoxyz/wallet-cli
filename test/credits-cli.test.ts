import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cliBundle } from "./cli-bundle.js";

import { useTempHome, walletState, writeWalletState } from "./helpers.js";
import { usdcToken } from "../src/shared/constants.js";
import { transferOptions, transferOutput } from "../src/schemas/transfer.js";
import { whoamiOptions, whoamiOutput } from "../src/schemas/whoami.js";
import { fundOptions } from "../src/schemas/fund.js";

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

afterEach(() => vi.unstubAllEnvs());

describe("removed credits", () => {
  it.each([
    ["whoami", "--credits"],
    ["fund", "--credits"],
    ["fund", "--credits", "--crypto"],
    ["fund", "--credits", "--referral-code", "CODE"],
    ["transfer", "--credits", "--mpp-challenge", "ignored"],
    ["transfer", "--credits", "--mpp-challenge", "ignored", "--dry-run"],
    ["transfer", "--mach=false", "--mpp-challenge", "ignored"],
    ["transfer", "--mach", "false", "--mpp-challenge", "ignored"],
    ["transfer", "--no-mach", "--mpp-challenge", "ignored"],
    ["transfer", "--credits=false", "--mpp-challenge", "ignored"],
    ["send", "1", usdcToken, recipient, "--credits=true", "--yes"],
  ])("refuses %j before any request or fallback payment", async (...args) => {
    await useTempHome();
    await writeWalletState(walletState());
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected listening address");
    const url = `http://127.0.0.1:${address.port}`;
    vi.stubEnv("TEMPO_AUTH_URL", url);
    vi.stubEnv("TEMPO_RPC_URL", url);
    try {
      const result = await cli(args);
      expect(result.code).not.toBe(0);
      expect(JSON.parse(result.stdout).code).toMatch(/^(UNKNOWN|E_USAGE)$/);
      expect(result.stderr).toBe("");
      expect(requests).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("removes active options and output shapes", () => {
    for (const schema of [whoamiOptions, fundOptions, transferOptions])
      expect(schema.shape).not.toHaveProperty("credits");
    for (const name of ["amount-cents", "to", "data"])
      expect(transferOptions.shape).not.toHaveProperty(name);
    expect(
      whoamiOutput.safeParse({ credits: { wallet: recipient, balance: "1", rawBalance: "1" } })
        .success,
    ).toBe(false);
    expect(
      transferOutput.safeParse({
        status: "dry_run",
        wallet: recipient,
        amount_cents: 100,
        network: "mainnet",
        chain_id: 4217,
        to: recipient,
        transaction_data: { type: "token", destination: recipient },
      }).success,
    ).toBe(false);
  });

  it("refuses positional token arguments instead of selecting another payment mode", async () => {
    await useTempHome();
    const result = await cli(["transfer", "1", usdcToken, recipient, "--mpp-challenge", "ignored"]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).message).toContain("use 'tempo wallet send'");
  });

  it("pays MACH challenges without a mode flag", async () => {
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
    const args = ["--mpp-challenge-file", file, "--max-spend", "1", "--dry-run"];
    const mach = await cli(["transfer", ...args]);
    expect(mach.code).toBe(0);
    expect(JSON.parse(mach.stdout)).toMatchObject({
      token: "MACH",
      raw_amount: "1000000",
      status: "dry_run",
    });
    expect(mach.stderr).toBe("");
    expect(JSON.parse(mach.stdout)._next.argv).not.toContain("--mach");
  });
});
