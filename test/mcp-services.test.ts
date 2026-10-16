import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cliBundle } from "./cli-bundle.js";
import { deviceCodeHost } from "./device-code-host.js";
import {
  readWalletStoreJson,
  testAccessKey,
  testWallet,
  usdc,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const root = resolve(import.meta.dirname, "..");
const mockFetchModule = resolve(root, "test", "fixtures", "mock-services-fetch.mjs");

// [tool, readOnlyHint, destructiveHint, idempotentHint, openWorldHint]
const toolHints = [
  ["address", true, false, true, false],
  ["balance", true, false, true, true],
  ["completions", true, false, true, false],
  ["config_get", true, false, true, false],
  ["config_set", false, true, true, false],
  ["config_unset", false, true, true, false],
  ["debug", true, false, true, true],
  ["doctor", true, false, true, true],
  ["fund", false, false, false, true],
  ["fund_status", false, false, true, true],
  ["keys_list", true, false, true, true],
  ["keys_update", false, true, false, true],
  ["login", false, true, false, true],
  ["login_status", false, true, true, true],
  ["logout", false, true, true, true],
  ["refresh", false, true, false, true],
  ["revoke", false, true, true, true],
  ["services", true, false, true, true],
  ["services_list", true, false, true, true],
  ["services_search", true, false, true, true],
  ["services_show", true, false, true, true],
  ["sessions_close", false, true, false, true],
  ["sessions_list", false, false, true, true],
  ["sessions_sync", false, true, true, true],
  ["swap", false, true, false, true],
  ["transfer", false, true, false, true],
  ["tx_status", true, false, true, true],
  ["whoami", true, false, true, true],
] as const;

const initParams = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "test-client", version: "1.0.0" },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MCP tools", () => {
  // Subprocesses inherit HOME, so the service directory cache stays out of the real wallet dir.
  beforeEach(async () => {
    await useTempHome();
  });

  it("accepts a direct credits recipient through MCP", async () => {
    await useTempHome();
    await writeWalletState(walletState());
    const response = await mcpCall({
      name: "transfer",
      arguments: {
        credits: true,
        "amount-cents": 1,
        to: testWallet,
        "dry-run": true,
      },
    });

    expect(response.error).toBeUndefined();
    expect(response.result.isError).not.toBe(true);
    expect(JSON.parse(firstToolText(response))).toMatchObject({
      wallet: testWallet.toLowerCase(),
      amount_cents: 1,
      to: testWallet.toLowerCase(),
      dry_run: true,
    });
  });

  it.each([{ amount: "1" }, { token: "0x1111111111111111111111111111111111111111" }])(
    "rejects token transfer arguments with credits through MCP: %j",
    async (args) => {
      await useTempHome();
      const response = await mcpCall({
        name: "transfer",
        arguments: { credits: true, "amount-cents": 1, to: testWallet, "dry-run": true, ...args },
      });

      expect(response.error).toBeUndefined();
      expect(response.result.isError).toBe(true);
      expect(firstToolText(response)).toContain("Positional amount, token, and recipient");
    },
  );

  it("returns the login command for a transfer without a wallet", async () => {
    const response = await mcpCall({
      name: "transfer",
      arguments: { amount: "1", token: usdc, to: testWallet, "dry-run": true, network: "testnet" },
    });

    const command = "tempo wallet login --network testnet";
    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      isError: true,
      _meta: { cta: { commands: [{ command }] } },
    });
    expect(firstToolText(response)).toBe(
      `No wallet is logged in. Run '${command}' before retrying.\n\nSuggested command:\n  ${command}`,
    );
  });

  it("returns the login code and URL as the tool result, then finishes in a later call", async () => {
    const host = deviceCodeHost((poll) => (poll < 2 ? "pending" : "approve"));
    const server = await host.listen();
    vi.stubEnv("TEMPO_AUTH_URL", server.url);
    try {
      const login = await mcpCall({
        name: "login",
        arguments: { network: "testnet", browser: false },
      });
      expect(login.result.isError).not.toBe(true);
      expect(JSON.parse(firstToolText(login))).toMatchObject({
        status: "pending",
        verification_url: `${server.url}/api/auth/device/verify?user_code=ABCDEFG1`,
        user_code: "ABCD-EFG1",
        _next: { command: "tempo wallet login status --interval 1 --network testnet" },
      });
      expect(host.polls).toEqual([]);

      const status = await mcpCall({ name: "login_status", arguments: { network: "testnet" } });
      expect(status.result.structuredContent).toMatchObject({
        accounts: [testWallet],
        chainId: 42431,
      });
      expect(host.polls).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it("exposes access key commands as nested tools", async () => {
    const response = await mcpRequest<{ tools: { name: string }[] }>("tools/list", {});

    expect(response.error).toBeUndefined();
    const names = response.result.tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "fund",
        "fund_status",
        "keys_list",
        "keys_update",
        "login",
        "login_status",
        "sessions_list",
      ]),
    );
    expect(names).not.toContain("keys");
    expect(names).not.toContain("sessions");
  });

  it("annotates every tool with its read, destructive, idempotent, and network hints", async () => {
    const response = await mcpRequest<{ tools: { name: string; annotations?: unknown }[] }>(
      "tools/list",
      {},
    );

    expect(response.error).toBeUndefined();
    expect(
      Object.fromEntries(response.result.tools.map((tool) => [tool.name, tool.annotations])),
    ).toEqual(
      Object.fromEntries(
        toolHints.map(([name, readOnlyHint, destructiveHint, idempotentHint, openWorldHint]) => [
          name,
          { readOnlyHint, destructiveHint, idempotentHint, openWorldHint },
        ]),
      ),
    );
  });

  it.each([
    {
      name: "swap",
      arguments: { amount: "1", tokenIn: "USDC.e", tokenOut: "pathUSD" },
      message: "Swap not submitted: review the quote with --dry-run, then pass --yes",
    },
    {
      name: "revoke",
      arguments: { accessKey: testAccessKey },
      message: "Revocation cannot be undone, so it needs confirmation.",
    },
    {
      name: "sessions_close",
      arguments: { url: `0x${"a".repeat(64)}` },
      message: "Closing a session cannot be undone, so it needs confirmation.",
    },
  ])("sends nothing for $name without yes", async ({ name, arguments: args, message }) => {
    await writeWalletState(walletState());
    const stored = await readWalletStoreJson();
    const host = await recordingHost();
    vi.stubEnv("TEMPO_AUTH_URL", host.url);
    vi.stubEnv("TEMPO_RPC_URL", host.url);
    try {
      const response = await mcpCall({ name, arguments: { ...args, network: "mainnet" } });

      expect(response.error).toBeUndefined();
      expect(response.result.isError).toBe(true);
      expect(firstToolText(response)).toContain(message);
      // Only reads reach the chain; nothing is signed, sent, or handed to the wallet app.
      expect(host.requests.filter((request) => request !== "eth_call")).toEqual([]);
      expect(await readWalletStoreJson()).toEqual(stored);
    } finally {
      await host.close();
    }
  });

  it.each([
    {
      name: "address",
      // An agent gets no QR code: the address is already the result.
      arguments: { qr: true },
      output: { address: testWallet.toLowerCase(), chain_id: 4217, network: "tempo" },
      requests: [],
    },
    {
      name: "balance",
      arguments: {},
      output: {
        address: testWallet.toLowerCase(),
        chain_id: 4217,
        network: "tempo",
        balances: [
          {
            token: usdc.toLowerCase(),
            symbol: "USDC.e",
            decimals: 6,
            balance: "1000000",
            verified: true,
          },
        ],
      },
      // The balance counts once the RPC reports mainnet.
      requests: [
        `GET /api/assets?address=${testWallet}&chainId=4217&fresh=true`,
        "eth_call",
        "eth_chainId",
      ],
    },
  ])(
    "serves $name with the command's output",
    async ({ name, arguments: args, output, requests }) => {
      await writeWalletState(walletState({ accessKeys: [] }));
      const host = await recordingHost();
      vi.stubEnv("TEMPO_AUTH_URL", host.url);
      vi.stubEnv("TEMPO_RPC_URL", host.url);
      try {
        const response = await mcpCall({ name, arguments: { ...args, network: "mainnet" } });

        expect(response.error).toBeUndefined();
        expect(response.result.isError).not.toBe(true);
        expect(response.result.structuredContent).toEqual(output);
        expect(firstToolText(response)).not.toContain("\u001b");
        expect(host.requests.toSorted()).toEqual(requests.toSorted());
      } finally {
        await host.close();
      }
    },
  );

  it("accepts the network global as a tool option on every command", async () => {
    const response = await mcpRequest<{
      tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[];
    }>("tools/list", {});

    expect(response.error).toBeUndefined();
    for (const tool of response.result.tools)
      expect(tool.inputSchema.properties, tool.name).toHaveProperty("network");
  });

  it.each([
    { source: "a tool option", stored: 4217, arguments: { network: "testnet" } },
    { source: "the logged-in chain", stored: 42431, arguments: {} },
  ])("resolves the tool network from $source", async ({ stored, arguments: args }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_WALLET_NETWORK", undefined);
    await writeWalletState(walletState({ chainId: stored }));

    const response = await mcpCall({ name: "doctor", arguments: args });

    expect(response.error).toBeUndefined();
    expect(response.result.structuredContent).toMatchObject({
      chain_id: 42431,
      network: "tempo-moderato",
    });
  });

  it("keeps normal CLI list JSON as a top-level array", async () => {
    const output = await walletCli([
      "services",
      "list",
      "--search",
      "__no_match__",
      "--format",
      "json",
    ]);

    expect(JSON.parse(output)).toEqual([]);
  });

  it.each([
    { name: "a search", options: {} },
    // No network applies to services; the injected network option must pass through harmlessly.
    { name: "refresh and network options", options: { refresh: true, network: "testnet" } },
  ])("wraps MCP list results in a top-level services object for $name", async ({ options }) => {
    const response = await mcpCall({
      name: "services",
      arguments: { serviceId: "list", search: "__no_match__", ...options },
    });

    expect(response.error).toBeUndefined();
    expect(response.result.structuredContent).toEqual({ services: [] });
    expect(JSON.parse(firstToolText(response))).toEqual({ services: [] });
  });

  it("leaves MCP service detail results unwrapped", async () => {
    const response = await mcpCall({
      name: "services",
      arguments: { serviceId: "weather" },
    });

    expect(response.error).toBeUndefined();
    expect(response.result.structuredContent).toMatchObject({ id: "weather" });
    expect(response.result.structuredContent).not.toHaveProperty("services");
    expect(JSON.parse(firstToolText(response))).toMatchObject({ id: "weather" });
  });

  // Each subcommand tool against the deprecated `services` call it replaces.
  it.each([
    { tool: "services_list", arguments: {}, deprecated: {}, data: { services: { length: 5 } } },
    {
      tool: "services_list",
      arguments: {},
      deprecated: { serviceId: "list" },
      data: { services: { length: 5 } },
    },
    {
      tool: "services_search",
      arguments: { query: "forecast" },
      deprecated: { search: "forecast" },
      data: { services: [{ id: "weather" }] },
    },
    {
      tool: "services_search",
      arguments: { query: "__no_match__" },
      deprecated: { serviceId: "list", search: "__no_match__" },
      data: { services: [] },
    },
    {
      tool: "services_show",
      arguments: { serviceId: "weather" },
      deprecated: { serviceId: "weather" },
      data: { id: "weather", endpoints: [{ payment: { price: "0.0001" } }] },
    },
  ])("$tool $arguments returns what services $deprecated does", async (call) => {
    const [response, deprecated] = await Promise.all([
      mcpCall({ name: call.tool, arguments: call.arguments }),
      mcpCall({ name: "services", arguments: call.deprecated }),
    ]);

    expect(response.error).toBeUndefined();
    expect(response.result.isError).not.toBe(true);
    expect(response.result.structuredContent).toMatchObject(call.data);
    expect(JSON.parse(firstToolText(response))).toEqual(response.result.structuredContent);
    expect(deprecated.result).toEqual(response.result);
  });

  it("shows a service whose id names a subcommand through services_show", async () => {
    const response = await mcpCall({ name: "services_show", arguments: { serviceId: "list" } });

    expect(response.result.isError).not.toBe(true);
    expect(response.result.structuredContent).toMatchObject({ id: "list" });
  });

  it("marks the services tool deprecated in favor of the subcommand tools", async () => {
    const response = await mcpRequest<{ tools: { name: string; description?: string }[] }>(
      "tools/list",
      {},
    );

    const descriptions = Object.fromEntries(
      response.result.tools.map((tool) => [tool.name, tool.description]),
    );
    expect(descriptions.services).toMatch(
      /^Deprecated: use services_list, services_search, or services_show\./,
    );
    for (const name of ["services_list", "services_search", "services_show"])
      expect(descriptions[name]).not.toContain("Deprecated");
  });
});

/**
 * Stands in for the chain RPC, on mainnet, and the wallet app. It answers `decimals()` with 6 and any other
 * `eth_call` with a balance or quote large enough for any test amount, and records every RPC
 * method and other request.
 */
async function recordingHost() {
  const requests: string[] = [];
  const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.url !== "/") {
        requests.push(`${request.method} ${request.url}`);
        response.statusCode = 404;
        response.end("{}");
        return;
      }
      const { id, method, params } = JSON.parse(body) as {
        id: number;
        method: string;
        params?: [{ data?: string }?];
      };
      requests.push(method);
      const decimals = params?.[0]?.data?.startsWith("0x313ce567");
      response.end(
        JSON.stringify(
          method === "eth_call"
            ? { jsonrpc: "2.0", id, result: word(decimals ? 6n : 10n ** 12n) }
            : method === "eth_chainId"
              ? { jsonrpc: "2.0", id, result: "0x1079" }
              : { jsonrpc: "2.0", id, error: { code: -32601, message: `Unexpected ${method}` } },
        ),
      );
    });
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected listening address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
  };
}

async function walletCli(args: string[]) {
  const { stdout } = await runNode([cliBundle("wallet"), ...args]);
  return stdout;
}

async function mcpCall(params: Record<string, unknown>) {
  return mcpRequest<{
    content: { text: string }[];
    isError?: boolean;
    structuredContent?: unknown;
    _meta?: unknown;
  }>("tools/call", params);
}

async function mcpRequest<result>(method: string, params: Record<string, unknown>) {
  const child = spawn(
    process.execPath,
    ["--import", mockFetchModule, cliBundle("wallet"), "--mcp"],
    {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const responses: unknown[] = [];
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    let index = stdout.indexOf("\n");
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) responses.push(JSON.parse(line));
      index = stdout.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams })}\n`,
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method, params })}\n`);

  try {
    const response = await waitForResponse(responses, 2, child, () => stderr);
    child.stdin.end();
    const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    if (exitCode !== 0) throw new Error(stderr || `MCP process exited with ${exitCode}`);
    return response as { error?: unknown; result: result };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function waitForResponse(
  responses: unknown[],
  id: number,
  child: ChildProcess,
  getStderr: () => string,
) {
  for (let index = 0; index < 500; index++) {
    const response = responses.find((item) => isRpcResponse(item, id));
    if (response) return response;
    if (child.exitCode !== null) {
      throw new Error(getStderr() || `MCP process exited with ${child.exitCode}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const diagnostic = getStderr().trim();
  throw new Error(
    diagnostic
      ? `Timed out waiting for MCP response ${id}: ${diagnostic}`
      : `Timed out waiting for MCP response ${id}`,
  );
}

function isRpcResponse(
  value: unknown,
  id: number,
): value is {
  error?: unknown;
  result: unknown;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    value.id === id &&
    ("result" in value || "error" in value)
  );
}

function firstToolText(response: { result: { content: { text: string }[] } }) {
  const item = response.result.content[0];
  if (!item) throw new Error("MCP response did not include text content");
  return item.text;
}

function runNode(args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--import", mockFetchModule, ...args], {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(stderr || `process exited with ${code}`));
    });
  });
}
