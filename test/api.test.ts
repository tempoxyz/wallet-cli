import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApiCli } from "../src/api.js";

const execFileAsync = promisify(execFile);
const requests: { path: string; method: string; key?: string; body: string }[] = [];
let url: string;
let status = 200;

const spec = {
  openapi: "3.1.0",
  info: { title: "Tempo API fixture", version: "1" },
  components: {
    securitySchemes: {
      apiKey: { type: "apiKey", in: "header", name: "tempo-api-key" },
    },
    schemas: {
      Deposit: {
        type: "object",
        required: ["chainId"],
        properties: { chainId: { type: "integer" } },
      },
    },
  },
  paths: {
    "/v1/routes/chains": {
      get: {
        summary: "Get chains",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
        responses: { "200": { description: "Chains" } },
      },
    },
    "/v1/routes/deposit-addresses": {
      post: {
        summary: "Create deposit address",
        security: [{ apiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/Deposit" } },
          },
        },
        responses: { "200": { description: "Deposit address" } },
      },
    },
    "/v1/routes/transfers/{id}": {
      get: {
        summary: "Get transfer",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Transfer" } },
      },
    },
    "/v1/tokens": {
      get: { summary: "List tokens", responses: { "200": { description: "Tokens" } } },
    },
  },
};

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/openapi.json" || request.url === "/custom/openapi.json") {
    response.end(JSON.stringify(spec));
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  const key = request.headers["tempo-api-key"];
  requests.push({
    path: request.url ?? "",
    method: request.method ?? "",
    ...(typeof key === "string" ? { key } : {}),
    body,
  });
  response.statusCode = status;
  response.end(
    JSON.stringify(
      status === 200
        ? { data: ["fixture"], nextCursor: null }
        : { message: "API rejected request" },
    ),
  );
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  requests.length = 0;
  status = 200;
});

describe("Tempo API extensions", () => {
  it("discovers routes without the v1 prefix or unrelated endpoint groups", async () => {
    const { stdout } = await cli("routes", ["--help"]);
    expect(stdout).toContain("tempo routes");
    expect(stdout).toContain("chains");
    expect(stdout).toContain("deposit-addresses");
    expect(stdout).not.toMatch(/^\s+tokens\s/m);
    expect(requests).toEqual([]);
  });

  it("keeps the full Tapimo API tree in the API extension", async () => {
    const { stdout } = await cli("api", ["v1", "--help"]);
    expect(stdout).toContain("tokens");
    expect(stdout).toContain("routes");
    await cli("api", ["v1", "tokens", "--format", "json"]);
    expect(requests[0]?.path).toBe("/v1/tokens");
  });

  it("restores the routing path and forwards typed query parameters", async () => {
    const { stdout } = await cli("routes", ["chains", "--limit", "2", "--format", "json"]);
    expect(JSON.parse(stdout)).toEqual({ data: ["fixture"], nextCursor: null });
    expect(requests).toEqual([{ path: "/v1/routes/chains?limit=2", method: "GET", body: "" }]);
  });

  it("preserves custom API base paths", async () => {
    await cli("routes", ["chains"], { TEMPO_API_URL: `${url}/custom/` });
    expect(requests[0]?.path).toBe("/custom/v1/routes/chains");
  });

  it("forwards path arguments", async () => {
    await cli("routes", ["transfers", "id", "test-transfer"]);
    expect(requests[0]?.path).toBe("/v1/routes/transfers/test-transfer");
  });

  it("resolves body references and sends API credentials with POST requests", async () => {
    await cli("routes", ["deposit-addresses", "--chainId", "4217"], {
      TEMPO_API_KEY: "fixture-key",
    });
    expect(requests).toEqual([
      {
        path: "/v1/routes/deposit-addresses",
        method: "POST",
        key: "fixture-key",
        body: JSON.stringify({ chainId: 4217 }),
      },
    ]);
  });

  it("lets explicit credentials override the default API key", async () => {
    await cli(
      "routes",
      ["deposit-addresses", "--chainId", "4217", "--tempo-api-key", "explicit-key"],
      { TEMPO_API_KEY: "default-key" },
    );
    expect(requests[0]?.key).toBe("explicit-key");
  });

  it("exposes schemas without executing an endpoint", async () => {
    const { stdout } = await cli("routes", ["deposit-addresses", "--schema", "--format", "json"]);
    expect(JSON.parse(stdout).options.properties.chainId.type).toBe("integer");
    expect(requests).toEqual([]);
  });

  it("discovers and calls routing tools over MCP", async () => {
    const api = await createApiCli({ url, routes: true, apiKey: "" });
    async function rpc(method: string, params: Record<string, unknown> = {}) {
      const response = await api.fetch(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
      );
      return response.json();
    }
    const tools = await rpc("tools/list");
    expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toContain("search_tools");
    const search = await rpc("tools/call", {
      name: "search_tools",
      arguments: { query: "chains" },
    });
    expect(
      JSON.parse(search.result.content[0].text).tools.map((tool: { name: string }) => tool.name),
    ).toContain("chains");
    expect(requests).toEqual([]);
    const result = await rpc("tools/call", {
      name: "call_read_tool",
      arguments: { name: "chains", arguments: { limit: 3 } },
    });
    expect(result.error).toBeUndefined();
    expect(result.result.isError).not.toBe(true);
    expect(requests[0]?.path).toBe("/v1/routes/chains?limit=3");
  });

  it.each([401, 402, 403, 500])("returns nonzero on HTTP %s without retrying", async (code) => {
    status = code;
    await expect(cli("routes", ["chains", "--format", "json"])).rejects.toMatchObject({ code: 1 });
    expect(requests).toHaveLength(1);
  });

  it.each(["api", "routes"] as const)(
    "reports the %s version without fetching the schema",
    async (extension) => {
      const { stdout } = await cli(extension, ["--version"], {
        TEMPO_API_URL: "http://127.0.0.1:1",
      });
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    },
  );

  it("reports schema failures with a nonzero exit status", async () => {
    await expect(
      cli("routes", ["--help"], { TEMPO_API_URL: "http://127.0.0.1:1" }),
    ).rejects.toMatchObject({ code: 1 });
  });
});

function cli(extension: "api" | "routes", args: string[], env: Record<string, string> = {}) {
  return execFileAsync(process.execPath, ["--import", "tsx", `src/${extension}-cli.ts`, ...args], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, TEMPO_API_KEY: "", TEMPO_API_URL: url, NO_COLOR: "1", ...env },
  });
}
