import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { Challenge, Credential } from "mppx";
import { afterEach, expect, it } from "vitest";

const exec = promisify(execFile);
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

async function fixture(
  intent = "charge",
  chain: number | undefined = 4217,
  requestOverrides: Record<string, unknown> = {},
) {
  let requests = 0;
  let authenticated = 0;
  let rpc = 0;
  const challenge = Challenge.from({
    id: "safety",
    realm: "local",
    method: "tempo",
    intent,
    request: {
      amount: "6000",
      currency: "0x20c0000000000000000000000000000000000000",
      recipient: "0x0000000000000000000000000000000000000001",
      methodDetails: chain ? { chainId: chain } : {},
      ...requestOverrides,
    },
  });
  const server = createServer((req, res) => {
    if (req.url === "/rpc") {
      rpc++;
      res.end("{}");
      return;
    }
    requests++;
    if (req.headers.authorization) {
      authenticated++;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Credential.deserialize(req.headers.authorization).payload));
      return;
    }
    res.writeHead(402, { "www-authenticate": Challenge.serialize(challenge) });
    res.end("Payment Required");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const url = `http://127.0.0.1:${address.port}`;
  const run = async (...args: string[]) => {
    try {
      return {
        ...(await exec(process.execPath, ["--import", "tsx", "src/request-cli.ts", url, ...args], {
          env: {
            ...process.env,
            TEMPO_RPC_URL: `${url}/rpc`,
            TEMPO_WALLET_NETWORK: "mainnet",
            TEMPO_PRIVATE_KEY: `0x${"1".repeat(64)}`,
          },
        })),
        code: 0,
      };
    } catch (error) {
      return error as { stdout: string; stderr: string; code: number };
    }
  };
  return { run, counts: () => ({ requests, authenticated, rpc }) };
}

it.each([
  ["--retries", "-1"],
  ["--retries", "1.5"],
  ["--timeout", "-1"],
  ["--max-spend", "banana"],
  ["--network", "typo"],
])("rejects %s %s before HTTP through the actual CLI", async (flag, value) => {
  const server = await fixture();
  const result = await server.run(flag, value);
  expect(result.code).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain("E_USAGE");
  expect(server.counts()).toEqual({ requests: 0, authenticated: 0, rpc: 0 });
});

it.each([
  ["--max-spend", "0.001", "max spend exceeded"],
  ["--network", "tempo-moderato", "network mismatch"],
])("rejects %s before wallet or RPC access", async (flag, value, message) => {
  const server = await fixture();
  const result = await server.run(flag, value);
  expect(result.code).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain(message);
  expect(server.counts()).toEqual({ requests: 1, authenticated: 0, rpc: 0 });
});

it("dry-run decodes and validates a quote without accessing the wallet", async () => {
  const server = await fixture();
  const result = await server.run(
    "--dry-run",
    "--max-spend",
    "0.006",
    "--timeout",
    "0.5",
    "--connect-timeout",
    "0.2",
  );
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    amount: "0.006",
    chain_id: 4217,
    within_budget: true,
  });
  const rejected = await server.run("--dry-run", "--max-spend", "0.001");
  expect(rejected.code).not.toBe(0);
  expect(server.counts()).toEqual({ requests: 2, authenticated: 0, rpc: 0 });
});

it("rejects capped recurring subscriptions before RPC or authorization", async () => {
  const server = await fixture("subscription");
  const result = await server.run("--max-spend", "0.006");
  expect(result.code).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`).toContain("cannot enforce cumulative spending");
  expect(server.counts()).toEqual({ requests: 1, authenticated: 0, rpc: 0 });
});

it("authenticates a zero-amount charge without a recipient or RPC access", async () => {
  const server = await fixture("charge", 4217, { amount: "0", recipient: undefined });
  const quote = await server.run("--dry-run", "--max-spend", "0");
  expect(quote.code).toBe(0);
  expect(JSON.parse(quote.stdout)).toMatchObject({ amount: "0", within_budget: true });
  expect(server.counts()).toEqual({ requests: 1, authenticated: 0, rpc: 0 });

  const result = await server.run("--max-spend", "0");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    type: "proof",
    signature: expect.stringMatching(/^0x[0-9a-f]+$/i),
  });
  expect(server.counts()).toEqual({ requests: 3, authenticated: 1, rpc: 0 });
});

it.each([
  ["charge", { recipient: undefined }, "valid recipient address"],
  ["charge", { recipient: "invalid" }, "valid recipient address"],
  ["charge", { amount: "0", currency: "invalid", recipient: undefined }, "valid currency address"],
  [
    "session",
    { amount: "0", recipient: undefined, methodDetails: { chainId: 4217, sessionProtocol: "v2" } },
    "valid recipient address",
  ],
  ["charge", { currency: "invalid" }, "valid currency address"],
  [
    "session",
    { recipient: undefined, methodDetails: { chainId: 4217, sessionProtocol: "v2" } },
    "valid recipient address",
  ],
  [
    "session",
    {
      methodDetails: {
        chainId: 4217,
        escrowContract: "0x0000000000000000000000000000000000000bad",
        sessionProtocol: "v2",
      },
    },
    "Unsupported Tempo session escrow",
  ],
  [
    "session",
    {
      methodDetails: {
        chainId: 4217,
        escrow: "0x0000000000000000000000000000000000000bad",
        sessionProtocol: "v2",
      },
    },
    "Unsupported Tempo session escrow",
  ],
  ["charge", { amount: undefined }, "valid amount"],
  ["charge", { amount: "not-a-number" }, "valid amount"],
] as const)(
  "rejects malformed %s offers before wallet access",
  async (intent, request, message) => {
    const server = await fixture(intent, 4217, request);
    for (const args of [["--dry-run"], []]) {
      const result = await server.run(...args);
      expect(result.code).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(message);
    }
    expect(server.counts()).toEqual({ requests: 2, authenticated: 0, rpc: 0 });
  },
);
