import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";

import { Challenge } from "mppx";
import { machineTokenDeployments } from "mppx/tempo";
import { afterEach, beforeEach, expect, it } from "vitest";

import { usdcToken } from "../src/shared/constants.js";
import { cliBundle } from "./cli-bundle.js";
import { testAccessKey, useTempHome, walletState, writeWalletState } from "./helpers.js";

// A CtaError thrown below a command's `run` keeps its cta on every surface. The access key's
// stored MACH limit is below this charge, which fails before any RPC read or signature.
const mach = machineTokenDeployments[4217].token.toLowerCase();
const command = `tempo wallet keys update ${testAccessKey} --token ${mach} --limit 0.015 --network mainnet`;
const message = `The access key cannot spend 0.015 MACH. Ask the wallet owner to run '${command}', then retry.`;
const cta = { description: "Suggested command:", commands: [{ command }] };
const challenge = Challenge.serialize(
  Challenge.from({
    id: "mach-offer",
    realm: "local",
    method: "tempo",
    intent: "charge",
    request: {
      amount: "15000",
      currency: usdcToken,
      recipient: "0x1111111111111111111111111111111111111111",
      methodDetails: { chainId: 4217, machineTokenEnabled: true },
    },
  }),
);

let env: NodeJS.ProcessEnv;
const servers: ReturnType<typeof createServer>[] = [];

beforeEach(async () => {
  const home = await useTempHome();
  const [key] = walletState().accessKeys;
  await writeWalletState(
    walletState({ accessKeys: [{ ...key!, limits: [{ token: mach, limit: "1000#__bigint" }] }] }),
  );
  env = {
    ...process.env,
    HOME: home,
    NO_COLOR: "1",
    TEMPO_RPC_URL: "http://127.0.0.1:9",
    TEMPO_WALLET_NETWORK: "mainnet",
  };
  delete env.TEMPO_PRIVATE_KEY;
  delete env.TEMPO_MAX_SPEND;
});

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

it("tempo wallet returns the cta", async () => {
  const result = await run(cliBundle("wallet"), [
    "transfer",
    "--mach",
    "--max-spend",
    "0.015",
    "--mpp-challenge",
    challenge,
    "--format",
    "json",
  ]);

  expect(result.code).toBe(4);
  expect(JSON.parse(result.stdout)).toEqual({
    code: "E_LIMIT_EXCEEDED",
    message,
    retryable: false,
    cta,
  });
});

it("tempo request returns the tempo wallet cta without its own prefix", async () => {
  let paid = 0;
  const service = createServer((request, response) => {
    if (request.headers.authorization) paid++;
    response.writeHead(402, { "www-authenticate": challenge }).end();
  });
  servers.push(service);
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  const address = service.address();
  if (!address || typeof address === "string") throw new Error("Expected address");

  const result = await run(cliBundle("request"), [
    "-j",
    "--mach",
    "--max-spend",
    "0.015",
    `http://127.0.0.1:${address.port}`,
  ]);

  expect(result.code).toBe(4);
  expect(JSON.parse(result.stderr)).toEqual({
    code: "E_LIMIT_EXCEEDED",
    message,
    retryable: false,
    cta,
  });
  expect(paid).toBe(0);
});

it("an MCP tool error carries the cta", async () => {
  const result = await mcpToolCall({
    name: "transfer",
    arguments: { mach: true, "max-spend": "0.015", "mpp-challenge": challenge },
  });

  expect(result).toEqual({
    content: [{ type: "text", text: `${message}\n\nSuggested command:\n  ${command}` }],
    _meta: { cta: { description: "Suggested command:", commands: [{ command }] } },
    isError: true,
  });
});

function run(bundle: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      [bundle, ...args],
      { env, timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      },
    );
  });
}

/** Calls one `tempo wallet --mcp` tool and returns its result. */
function mcpToolCall(params: Record<string, unknown>) {
  const child = spawn(process.execPath, [cliBundle("wallet"), "--mcp"], { env });
  const requests = [
    {
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    },
    { method: "tools/call", params },
  ];
  for (const [id, request] of requests.entries())
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...request })}\n`);
  return new Promise<unknown>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for the MCP tool result: ${stderr}`));
    }, 10_000);
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.on("data", (chunk) => {
      const lines = `${stdout}${chunk}`.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        const response = JSON.parse(line) as { id?: number; result?: unknown };
        if (response.id !== 1) continue;
        clearTimeout(timer);
        child.stdin.end();
        resolve(response.result);
      }
    });
  });
}
