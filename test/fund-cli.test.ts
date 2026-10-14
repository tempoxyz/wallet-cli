import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { cliBundle } from "./cli-bundle.js";
import { useTempHome } from "./helpers.js";

const exec = promisify(execFile);
const wallet = "0x1111111111111111111111111111111111111111";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** A local JSON-RPC endpoint whose `balanceOf` answer the test sets. */
async function balanceRpc() {
  const rpc = { balance: 0n, url: "" };
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { id, method } = JSON.parse(body) as { id: number; method: string };
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        method === "eth_call"
          ? { jsonrpc: "2.0", id, result: `0x${rpc.balance.toString(16).padStart(64, "0")}` }
          : { jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported ${method}` } },
      ),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected listening address");
  rpc.url = `http://127.0.0.1:${address.port}`;
  return rpc;
}

async function fund(args: string[], env: Record<string, string>) {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [cliBundle("wallet"), ...args, "--no-browser", "--format", "json"],
      {
        env: {
          ...process.env,
          NO_COLOR: "1",
          TEMPO_AUTH_URL: "https://wallet.example.test",
          TEMPO_WALLET_FUND_POLL_MS: "20",
          ...env,
        },
      },
    );
    return { code: 0, json: JSON.parse(stdout) as Record<string, unknown>, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return {
      code: failed.code,
      json: failed.stdout ? (JSON.parse(failed.stdout) as Record<string, unknown>) : {},
      stderr: failed.stderr,
    };
  }
}

describe("fund CLI", () => {
  it.each([
    {
      flow: "MACH",
      args: ["fund", "--mach", "--address", wallet, "--amount", "5", "--network", "mainnet"],
      url: `https://wallet.example.test/agent?action=fund&intent=mach&address=${wallet}&chainId=4217&amount=5`,
      deposit: 5_000_000n,
      received: "5",
    },
    {
      flow: "testnet faucet",
      args: ["fund", "--crypto", "--address", wallet, "--network", "testnet"],
      url: `https://wallet.example.test/agent?action=crypto&address=${wallet}&chainId=42431`,
      deposit: 10_000n,
      received: "0.01",
    },
  ])(
    "resumes a $flow no-wait handoff through its status check",
    async ({ args, url, deposit, received }) => {
      await useTempHome();
      const rpc = await balanceRpc();
      rpc.balance = 10_000_000n;
      const env = { TEMPO_RPC_URL: rpc.url };

      const handoff = await fund([...args, "--no-wait"], env);
      expect(handoff).toMatchObject({
        code: 0,
        json: { status: "pending", url, raw_balance: "10000000", received: "0" },
      });
      const next = (handoff.json._next as { argv: string[] }).argv;
      expect(next).toEqual(expect.arrayContaining(["--baseline", "10000000", "--no-wait"]));

      expect(await fund(next.slice(2), env)).toMatchObject({
        code: 0,
        json: { status: "pending" },
      });
      rpc.balance += deposit;
      const done = await fund(next.slice(2), env);
      expect(done).toMatchObject({ code: 0, json: { status: "success", url, received } });
      expect(done.json).not.toHaveProperty("_next");
    },
    30_000,
  );

  it("exits with E_POLL_TIMEOUT's code and returns the link and a status check", async () => {
    await useTempHome();
    const rpc = await balanceRpc();
    rpc.balance = 10_000_000n;
    const url = `https://wallet.example.test/agent?action=fund&intent=mach&address=${wallet}&chainId=4217&amount=5`;

    const result = await fund(
      ["fund", "--mach", "--address", wallet, "--amount", "5", "--network", "mainnet"],
      { TEMPO_RPC_URL: rpc.url, TEMPO_WALLET_FUND_TIMEOUT_MS: "200" },
    );
    expect(result).toMatchObject({
      code: 3,
      json: {
        status: "timeout",
        url,
        _next: {
          command: `tempo wallet fund --mach --address ${wallet} --amount 5 --baseline 10000000 --no-wait --network mainnet`,
          until: '.status == "success"',
          poll_interval_seconds: 10,
        },
      },
    });
    expect(result.stderr).toContain(`Open this link on your device: ${url}`);
  }, 30_000);

  it.each([
    { mode: "no-wait", args: ["--no-wait"], code: 0, json: { status: "pending", balance: null } },
    { mode: "wait", args: [], code: 1, json: {} },
  ])(
    "shows the link when the balance RPC is down ($mode)",
    async ({ args, code, json }) => {
      await useTempHome();
      const url = `https://wallet.example.test/agent?action=fund&address=${wallet}&chainId=4217`;

      const result = await fund(["fund", "--address", wallet, "--network", "mainnet", ...args], {
        TEMPO_RPC_URL: "http://127.0.0.1:9",
      });
      expect(result).toMatchObject({ code, json });
      expect(result.json).not.toHaveProperty("_next");
      expect(`${JSON.stringify(result.json)}${result.stderr}`).toContain(url);
    },
    30_000,
  );
});
