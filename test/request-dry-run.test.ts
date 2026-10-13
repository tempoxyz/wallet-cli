import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Challenge } from "mppx";
import { afterEach, expect, it } from "vitest";

import { cliBundle } from "./cli-bundle.js";
import { useTempHome } from "./helpers.js";

const exec = promisify(execFile);
const body = "server-body-must-not-leak";
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

const challenge = Challenge.from({
  id: "dry-run",
  realm: "local",
  method: "tempo",
  intent: "charge",
  request: {
    amount: "6000",
    currency: "0x20c0000000000000000000000000000000000000",
    recipient: "0x0000000000000000000000000000000000000001",
    methodDetails: { chainId: 4217 },
  },
});

const quote = {
  payment_required: true,
  method: "tempo",
  intent: "charge",
  recurring: false,
  amount: "0.006",
  amount_raw: "6000",
  token: "0x20c0000000000000000000000000000000000000",
  machine_token_enabled: false,
  payment_token: null,
  chain_id: 4217,
  max_spend: null,
  within_budget: null,
  signer: { address: null, source: "wallet" },
};

async function fixture(status: number) {
  const methods: string[] = [];
  const server = createServer((req, res) => {
    methods.push(req.method ?? "");
    if (status === 402) res.setHeader("www-authenticate", Challenge.serialize(challenge));
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const run = (...args: string[]) =>
    exec(process.execPath, [cliBundle("request"), `http://127.0.0.1:${address.port}`, ...args], {
      env: {
        ...process.env,
        TEMPO_MAX_SPEND: "",
        TEMPO_PRIVATE_KEY: "",
        TEMPO_WALLET_NETWORK: "mainnet",
      },
    });
  return { methods, run };
}

function expected(method: string, status: number, warns: boolean) {
  if (status === 402) return quote;
  return {
    payment_required: false,
    status,
    probe_sent: true,
    ...(warns
      ? { warning: `The ${method} request was sent to the server and may have had side effects` }
      : {}),
  };
}

it.each(
  [
    { method: "GET", warns: false },
    { method: "HEAD", warns: false },
    { method: "POST", warns: true },
    { method: "DELETE", warns: true },
  ].flatMap((row) => [200, 404, 500, 402].map((status) => ({ ...row, status }))),
)(
  "dry-runs $method answering $status without leaking the body",
  async ({ method, status, warns }) => {
    const home = await useTempHome();
    const headers = join(home, "headers.txt");
    const meta = join(home, "meta.json");
    const server = await fixture(status);

    const result = await server.run("-X", method, "--dry-run", "-D", headers, "--write-meta", meta);

    expect(result.stdout).not.toContain(body);
    expect(JSON.parse(result.stdout)).toEqual(expected(method, status, warns));
    expect(server.methods).toEqual([method]);
    expect(await readFile(headers, "utf8")).toMatch(new RegExp(`^HTTP ${status}\\n`));
    expect(JSON.parse(await readFile(meta, "utf8"))).toMatchObject({ status });
  },
);

it.each([200, 402])("writes the %s dry-run result to -o instead of the body", async (status) => {
  const home = await useTempHome();
  const output = join(home, "out.json");
  const server = await fixture(status);

  const result = await server.run("-X", "POST", "--dry-run", "-o", output);

  expect(result.stdout).toBe("");
  const text = await readFile(output, "utf8");
  expect(text).not.toContain(body);
  expect(JSON.parse(text)).toEqual(expected("POST", status, true));
});
