import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { Challenge, Credential } from "mppx";
import { afterEach, expect, it, vi } from "vitest";

import { cliBundle } from "./cli-bundle.js";

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
  const cli = async (argv: string[], env: Record<string, string> = {}) => {
    try {
      return {
        ...(await exec(process.execPath, [cliBundle("request"), ...argv], {
          env: {
            ...process.env,
            TEMPO_RPC_URL: `${url}/rpc`,
            TEMPO_WALLET_NETWORK: "mainnet",
            TEMPO_PRIVATE_KEY: `0x${"1".repeat(64)}`,
            ...env,
          },
        })),
        code: 0,
      };
    } catch (error) {
      return error as { stdout: string; stderr: string; code: number };
    }
  };
  const run = (...args: string[]) => cli([url, ...args]);
  return { cli, run, url, counts: () => ({ requests, authenticated, rpc }) };
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

it("applies TEMPO_MAX_SPEND when --max-spend is omitted", async () => {
  vi.stubEnv("TEMPO_MAX_SPEND", "0.001");
  try {
    const server = await fixture();
    const result = await server.run();
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("max spend exceeded");
    expect(server.counts()).toEqual({ requests: 1, authenticated: 0, rpc: 0 });
  } finally {
    vi.unstubAllEnvs();
  }
});

// `{url}` stands for the fixture URL. The rerun keeps every other argument, bound to its option
// as incur parses it, and sets --max-spend and --network itself.
it.each([
  {
    name: "the URL alone",
    argv: ["{url}"],
    cta: "tempo request -j {url} --max-spend 25 --network mainnet",
  },
  {
    name: "request options and a lower --max-spend",
    argv: ["-X", "POST", "--json", '{"a":1}', "-H", "x-a: b", "--max-spend", "5", "{url}"],
    max: "5",
    cta: `tempo request -j --request=POST '--json={"a":1}' '--header=x-a: b' {url} --max-spend 25 --network mainnet`,
  },
  {
    name: "a network in a flag stack",
    argv: ["-sn", "testnet", "{url}"],
    chain: 42431,
    cta: "tempo request -j -s {url} --max-spend 25 --network testnet",
  },
  {
    name: "an option value that looks like a network flag",
    argv: ["-d", "-n", "--network=mainnet", "{url}"],
    cta: "tempo request -j --data=-n {url} --max-spend 25 --network mainnet",
  },
  {
    name: "TEMPO_MAX_SPEND and TEMPO_WALLET_NETWORK",
    argv: ["{url}"],
    env: { TEMPO_MAX_SPEND: "5", TEMPO_WALLET_NETWORK: "testnet" },
    chain: 42431,
    max: "5",
    cta: "tempo request -j {url} --max-spend 25 --network testnet",
  },
  {
    name: "a dry run",
    argv: ["--dry-run", "{url}"],
    cta: "tempo request -j --dry-run {url} --max-spend 25 --network mainnet",
  },
])(
  "refuses a charge over the cap with a rerun of $name",
  async ({ argv, env = {}, chain = 4217, max = "10 (default)", cta }) => {
    const server = await fixture("charge", chain, { amount: "25000000" });
    const withUrl = (value: string) => value.replaceAll("{url}", server.url);
    const result = await server.cli(["-j", ...argv.map(withUrl)], { TEMPO_MAX_SPEND: "", ...env });
    const command = withUrl(cta);
    expect(result.code).toBe(4);
    expect(JSON.parse(result.stderr)).toEqual({
      code: "E_LIMIT_EXCEEDED",
      message: `Payment max spend exceeded: max=${max} required=25. To allow it, rerun: ${command}`,
      retryable: false,
      cta: { description: "Suggested command:", commands: [{ command }] },
    });
    expect(server.counts()).toEqual({ requests: 1, authenticated: 0, rpc: 0 });
  },
);

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

it.each([
  { insecure: false, allow: false, dryRun: false, outcome: "paid" },
  { insecure: false, allow: true, dryRun: false, outcome: "paid" },
  { insecure: true, allow: false, dryRun: false, outcome: "refused" },
  { insecure: true, allow: true, dryRun: false, outcome: "paid" },
  { insecure: false, allow: false, dryRun: true, outcome: "quoted" },
  { insecure: false, allow: true, dryRun: true, outcome: "quoted" },
  { insecure: true, allow: false, dryRun: true, outcome: "quoted" },
  { insecure: true, allow: true, dryRun: true, outcome: "quoted" },
] as const)(
  "insecure=$insecure allow=$allow dry-run=$dryRun $outcome a 402",
  async ({ insecure, allow, dryRun, outcome }) => {
    const server = await fixture("charge", 4217, { amount: "0", recipient: undefined });
    const result = await server.run(
      ...(insecure ? ["-k"] : []),
      ...(allow ? ["--allow-insecure-payment"] : []),
      ...(dryRun ? ["--dry-run"] : []),
    );
    if (outcome === "refused") {
      expect(result.code).toBe(4);
      expect(`${result.stdout}${result.stderr}`).toMatch(
        /E_PAYMENT[\s\S]*--allow-insecure-payment/,
      );
    } else {
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject(
        outcome === "paid" ? { type: "proof" } : { payment_required: true, amount: "0" },
      );
    }
    expect(server.counts()).toEqual({
      requests: outcome === "paid" ? 2 : 1,
      authenticated: outcome === "paid" ? 1 : 0,
      rpc: 0,
    });
  },
);

it.each([
  ["charge", ["--stream"]],
  ["charge", ["--sse-json"]],
  ["session", []],
] as const)(
  "refuses %s payments with %j over insecure TLS before wallet access",
  async (intent, flags) => {
    const server = await fixture(intent, 4217, {
      methodDetails: { chainId: 4217, sessionProtocol: "v2" },
    });
    const result = await server.run("--insecure", ...flags);
    expect(result.code).toBe(4);
    expect(`${result.stdout}${result.stderr}`).toMatch(/E_PAYMENT[\s\S]*--allow-insecure-payment/);
    expect(server.counts()).toEqual({ requests: 1, authenticated: 0, rpc: 0 });
  },
);
