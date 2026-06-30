import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const mockFetchModule = resolve(root, "test", "fixtures", "mock-services-fetch.mjs");

const initParams = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "test-client", version: "1.0.0" },
};

describe("services MCP tool", () => {
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

  it("wraps MCP list results in a top-level services object", async () => {
    const response = await mcpCall({
      name: "services",
      arguments: { serviceId: "list", search: "__no_match__" },
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
});

async function walletCli(args: string[]) {
  const { stdout } = await runNode(["src/cli.ts", ...args]);
  return stdout;
}

async function mcpCall(params: Record<string, unknown>) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", mockFetchModule, "src/cli.ts", "--mcp"],
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
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params })}\n`);

  try {
    const response = await waitForResponse(responses, 2);
    child.stdin.end();
    const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    if (exitCode !== 0) throw new Error(stderr || `MCP process exited with ${exitCode}`);
    return response;
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function waitForResponse(responses: unknown[], id: number) {
  for (let index = 0; index < 100; index++) {
    const response = responses.find((item) => isRpcResponse(item, id));
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for MCP response ${id}`);
}

function isRpcResponse(
  value: unknown,
  id: number,
): value is {
  error?: unknown;
  result: { content: { text: string }[]; structuredContent?: unknown };
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
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--import", mockFetchModule, ...args],
      {
        cwd: root,
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
