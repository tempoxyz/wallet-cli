import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { cliBundle } from "./cli-bundle.js";
import { appUrl } from "../src/shared/network.js";
import { loadPendingFund } from "../src/wallet/store.js";
import { testWallet, useTempHome, walletState, writeWalletState } from "./helpers.js";

const execFileAsync = promisify(execFile);

const address = "0x1111111111111111111111111111111111111111";
const handoff = ["--address", address, "--no-browser", "--no-wait"];
/** The wallet app's funding page, on the app `TEMPO_AUTH_URL` names for these subprocesses. */
const agent = new URL("/agent", appUrl).toString();
const fundUrl = `${agent}?action=fund&address=${address}&chainId=42431`;
// The test RPC is unreachable, so the handoff carries an instruction instead of a `_next`.
const fundToon = `status: pending
wallet: ${address}
action: fund
url: "${fundUrl}"
chain_id: 42431
network: tempo-moderato
token: 0x20c0000000000000000000000000000000000000
symbol: pathUSD
amount: null
balance: null
raw_balance: null
instruction: "Could not read the wallet's starting balance (check TEMPO_RPC_URL), so 'tempo wallet fund status' cannot tell when funds arrive. Finish funding at ${fundUrl}, then check the balance of ${address}."
`;
const sessionsToon = `chain_id: 42431
network: tempo-moderato
sessions: []
total: 0
`;

describe("wallet flags parse the same in any position", () => {
  it.each([
    [["-n", "testnet", "fund", ...handoff]],
    [["fund", ...handoff, "-n", "testnet"]],
    [["--network", "testnet", "fund", ...handoff]],
    [["fund", "--network=testnet", ...handoff]],
    [["--format", "json", "-n", "testnet", "fund", ...handoff]],
    [["fund", ...handoff, "-sn", "testnet"]],
  ])("%j", async (args) => {
    await useTempHome();
    const result = await wallet(args.includes("--format") ? args : [...args, "--format", "json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "pending",
      wallet: address,
      action: "fund",
      url: fundUrl,
      chain_id: 42431,
      network: "tempo-moderato",
      token: "0x20c0000000000000000000000000000000000000",
      symbol: "pathUSD",
      amount: null,
      balance: null,
      raw_balance: null,
      // The default RPC is unreachable, so the handoff cannot be resumed.
      instruction: expect.stringContaining(`Finish funding at ${fundUrl}`),
    });
  });

  it.each(
    [
      {
        output: fundToon,
        variants: [
          ["-n", "testnet", "fund", ...handoff],
          ["fund", ...handoff, "-n", "testnet"],
        ],
      },
      {
        output: sessionsToon,
        variants: [
          ["-n", "testnet", "sessions"],
          ["sessions", "-n", "testnet"],
          ["sessions", "list", "-t", "-n", "testnet"],
        ],
      },
    ].flatMap(({ output, variants }) =>
      variants.flatMap((args) =>
        [["--format", "toon", ...args], [...args, "--format", "toon"], args].map(
          (argv) => [argv, output] as const,
        ),
      ),
    ),
  )("%j renders toon", async (argv, output) => {
    await useTempHome();
    const result = await wallet(argv);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(output);
  });
});

describe("sessions", () => {
  it.each([
    [["sessions", "-n", "testnet"]],
    [["sessions", "list", "--network", "testnet"]],
    [["-n", "testnet", "sessions"]],
    [["sessions", "-sn", "testnet"]],
  ])("%j lists sessions", async (args) => {
    await useTempHome();
    const result = await wallet([...args, "--format", "json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      chain_id: 42431,
      network: "tempo-moderato",
      sessions: [],
      total: 0,
    });
  });

  it("documents the bare listing and its subcommands in help", async () => {
    const { stdout } = await wallet(["sessions", "--help"]);

    expect(stdout).toContain("Usage: tempo wallet sessions [options] | <command>");
    expect(stdout).toContain("--orphaned");
    expect(stdout).toMatch(/close\s+Request a session close/);
  });
});

describe("help", () => {
  it.each([
    [["help"], ["--help"]],
    [
      ["help", "fund"],
      ["fund", "--help"],
    ],
    [
      ["help", "sessions", "list"],
      ["sessions", "list", "--help"],
    ],
    [
      ["-n", "testnet", "help", "swap"],
      ["swap", "--help"],
    ],
  ])("%j matches %j", async (args, expected) => {
    const [actual, help] = await Promise.all([wallet(args), wallet(expected)]);

    expect(actual).toEqual(help);
    expect(actual.code).toBe(0);
    expect(actual.stdout).toContain("Usage: tempo wallet");
  });

  it("lists every command, including swap", async () => {
    const { stdout } = await wallet(["help"]);

    for (const command of ["swap", "fund", "sessions", "completions", "mcp", "skills"])
      expect(stdout).toMatch(new RegExp(`^\\s+${command}\\s`, "m"));
  });
});

describe("fund", () => {
  it.each([{ flags: [] }, { flags: ["--no-wait"] }, { flags: ["--wait", "--no-wait"] }])(
    "returns a handoff with only its starting balance read with $flags",
    async ({ flags }) => {
      await useTempHome();
      await writeWalletState(walletState({ chainId: 42431 }));
      const rpc = await balanceRpc([0n]);
      try {
        const result = await wallet(
          ["fund", "--no-browser", "--amount", "17.43", ...flags, "--format", "json"],
          {
            TEMPO_RPC_URL: rpc.url,
            TEMPO_WALLET_FUND_TIMEOUT_MS: "invalid",
            TEMPO_WALLET_FUND_POLL_MS: "invalid",
          },
        );

        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          status: "pending",
          chain_id: 42431,
          network: "tempo-moderato",
          amount: "17.43",
          balance: null,
          raw_balance: null,
          _next: { command: "tempo wallet fund status --interval 5 --network testnet" },
        });
        expect(result.stderr).not.toContain("Waiting");
        expect(rpc.calls()).toBe(1);
        expect(await loadPendingFund()).toMatchObject({ network: "testnet", amount: "17.43" });
      } finally {
        await rpc.close();
      }
    },
  );

  it.each(["--llms", "--llms-full", "--schema", "--help"])(
    "%s describes the command without starting a funding flow",
    async (flag) => {
      await useTempHome();
      await writeWalletState(walletState());
      const rpc = await balanceRpc([0n]);
      try {
        const result = await wallet(["fund", flag, "--no-browser"], {
          TEMPO_RPC_URL: rpc.url,
          TEMPO_WALLET_FUND_POLL_MS: "50",
          TEMPO_WALLET_FUND_TIMEOUT_MS: "2000",
        });

        expect(result.code).toBe(0);
        expect(result.stdout).toContain("fund");
        expect(result.stderr).not.toContain("Waiting");
        expect(rpc.calls()).toBe(0);
      } finally {
        await rpc.close();
      }
    },
  );

  it.each([
    {
      name: "the requested deposit",
      balances: [0n, 17_430_000n],
      code: 0,
      output: {
        status: "success",
        wallet: testWallet.toLowerCase(),
        chain_id: 42431,
        balance: "17.43",
      },
    },
    {
      name: "a timeout after an unrelated deposit",
      balances: [0n, 1_000_000n],
      code: 3,
      output: {
        code: "E_POLL_TIMEOUT",
        retryable: true,
        message: expect.stringContaining(`${agent}?action=fund`),
        cta: {
          commands: [{ command: "tempo wallet fund status --interval 5 --network testnet" }],
        },
      },
    },
  ])("waits for funding and renders $name through incur", async ({ balances, code, output }) => {
    await useTempHome();
    await writeWalletState(walletState());
    const rpc = await balanceRpc(balances);
    try {
      const result = await wallet(
        [
          "-n",
          "testnet",
          "fund",
          "--no-browser",
          "--no-wait",
          "--wait",
          "--amount",
          "17.43",
          "--timeout",
          "1",
          "--format",
          "json",
        ],
        { TEMPO_RPC_URL: rpc.url, TEMPO_WALLET_FUND_POLL_MS: "50" },
      );

      expect(result.code).toBe(code);
      expect(JSON.parse(result.stdout)).toMatchObject(output);
      expect(result.stderr).toContain("Waiting for funding...");
    } finally {
      await rpc.close();
    }
  });

  it.each([
    {
      name: "funds that arrived",
      balances: [0n, 17_430_000n],
      code: 0,
      output: { status: "success", action: "fund", balance: "17.43", symbol: "pathUSD" },
    },
    {
      name: "funds still on their way",
      balances: [0n],
      code: 3,
      output: {
        code: "E_POLL_TIMEOUT",
        retryable: true,
        cta: {
          commands: [{ command: "tempo wallet fund status --max-attempts 1 --network testnet" }],
        },
      },
    },
  ])("fund status resumes in a later process with $name", async ({ balances, code, output }) => {
    await useTempHome();
    await writeWalletState(walletState({ chainId: 42431 }));
    const rpc = await balanceRpc(balances);
    const env = { TEMPO_RPC_URL: rpc.url, TEMPO_AUTH_URL: "https://wallet-preview.tempo.local" };
    try {
      const fund = await wallet(
        ["fund", "--no-browser", "--amount", "17.43", "-n", "testnet", "--format", "json"],
        env,
      );
      const status = await wallet(
        ["fund", "status", "--max-attempts", "1", "-n", "testnet", "--format", "json"],
        env,
      );

      expect(fund.code, fund.stderr).toBe(0);
      expect(JSON.parse(fund.stdout)).toMatchObject({
        status: "pending",
        url: `https://wallet-preview.tempo.local/agent?action=fund&address=${testWallet.toLowerCase()}&chainId=42431&amount=17.43`,
      });
      expect(status.code, status.stderr).toBe(code);
      expect(JSON.parse(status.stdout)).toMatchObject(output);
    } finally {
      await rpc.close();
    }
  });

  it.each([
    {
      args: ["fund", "--no-browser", "--no-wait"],
      code: 2,
      output: {
        code: "E_USAGE",
        message: "Configuration missing: No wallet configured. Run 'tempo wallet login'.",
        retryable: false,
      },
    },
    {
      args: ["fund", "--not-a-real-option"],
      code: 1,
      output: { code: "UNKNOWN", message: "Unknown flag: --not-a-real-option" },
    },
    {
      args: ["fund", "status", "-n", "testnet"],
      code: 2,
      output: {
        code: "E_USAGE",
        message:
          "No funding is pending on testnet. Run 'tempo wallet fund --network testnet' to start one.",
        retryable: false,
        cta: {
          description: "Suggested command:",
          commands: [{ command: "tempo wallet fund --network testnet" }],
        },
      },
    },
  ])("reports $output.code for $args", async ({ args, code, output }) => {
    await useTempHome();
    const result = await wallet([...args, "--format", "json"]);

    expect(result.code).toBe(code);
    expect(JSON.parse(result.stdout)).toEqual(output);
  });

  it.each([
    [["fund", ...handoff]],
    [["fund", "--crypto", ...handoff]],
    [["fund", "--referral-code", "REF123", ...handoff]],
    [["fund", "--mach", ...handoff, "-n", "mainnet"]],
  ])("%j renders the same keys in toon and JSON", async (args) => {
    await useTempHome();
    const json = await wallet([...args, "--format", "json"]);
    const toon = await wallet([...args, "--format", "toon"]);

    expect([json.code, toon.code]).toEqual([0, 0]);
    expect(toonKeys(toon.stdout)).toEqual(Object.keys(JSON.parse(json.stdout)));
  });
});

async function wallet(args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliBundle("wallet"), ...args],
      {
        env: { ...process.env, NO_COLOR: "1", ...env },
      },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

/** The top-level keys of a toon object: each unindented `key:` line, in order. */
function toonKeys(toon: string) {
  return toon.split("\n").flatMap((line) => /^(\w+)[[{:]/.exec(line)?.[1] ?? []);
}

// Answers every balanceOf call with the next balance, repeating the last one.
async function balanceRpc(balances: bigint[]) {
  let calls = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: number };
      const balance = balances[Math.min(calls++, balances.length - 1)]!;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: `0x${balance.toString(16).padStart(64, "0")}`,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverAddress = server.address();
  if (!serverAddress || typeof serverAddress === "string") throw new Error("No RPC address");
  return {
    url: `http://127.0.0.1:${serverAddress.port}`,
    calls: () => calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
