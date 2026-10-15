import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";

import { Challenge, Credential } from "mppx";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, expect, it, vi } from "vitest";

import { executeRequest, type RequestOptions, runRequest } from "../src/commands/request.js";
import {
  expectUsageError,
  testPrivateKey,
  testPrivateKey2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";
import { cliBundle } from "./cli-bundle.js";

const exec = promisify(execFile);
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
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

const flagAddress = privateKeyToAccount(testPrivateKey2).address;
const envAddress = privateKeyToAccount(testPrivateKey).address;
const flagNotice = `Paying with key from --private-key (${flagAddress}), not the logged-in wallet\n`;
const warning =
  "--private-key can leak through shell history and process listings; set TEMPO_PRIVATE_KEY instead";
const flagWarning = `Warning: ${warning}\n`;
const flagMeta = { address: flagAddress, source: "flag", warning };

it.each([
  {
    name: "flag",
    flag: testPrivateKey2,
    env: undefined,
    signer: { address: flagAddress, source: "flag" },
    stderr: `${flagNotice}${flagWarning}`,
    meta: flagMeta,
  },
  {
    name: "env",
    flag: undefined,
    env: testPrivateKey,
    signer: { address: envAddress, source: "env" },
    stderr: `Paying with key from TEMPO_PRIVATE_KEY (${envAddress}), not the logged-in wallet\n`,
    meta: { address: envAddress, source: "env" },
  },
  {
    name: "flag over env",
    flag: testPrivateKey2,
    env: testPrivateKey,
    signer: { address: flagAddress, source: "flag" },
    stderr: `${flagNotice}${flagWarning}`,
    meta: flagMeta,
  },
  {
    name: "no key",
    flag: undefined,
    env: undefined,
    signer: { address: null, source: "wallet" },
    stderr: "",
    meta: undefined,
  },
  {
    name: "empty env",
    flag: undefined,
    env: "",
    signer: { address: null, source: "wallet" },
    stderr: "",
    meta: undefined,
  },
])("reports the payment signer for $name without echoing keys", async (row) => {
  const home = await useTempHome();
  await writeWalletState(walletState());
  vi.stubEnv("TEMPO_PRIVATE_KEY", row.env);
  const server = await fixture();
  const args = row.flag === undefined ? [] : ["--private-key", row.flag];

  const quote = { stdout: capture(), stderr: capture() };
  await runRequest([...args, "--dry-run", server.url], quote);
  expect(JSON.parse(quote.stdout.text())).toMatchObject({ signer: row.signer });
  expect(quote.stderr.text()).toBe("");

  const paid = { stdout: capture(), stderr: capture() };
  const metaPath = join(home, "meta.json");
  await runRequest([...args, "--write-meta", metaPath, server.url], paid);
  if (row.signer.address)
    expect(JSON.parse(paid.stdout.text()).source).toMatch(
      new RegExp(`${row.signer.address}$`, "i"),
    );
  expect(paid.stderr.text()).toBe(row.stderr);
  const meta = await readFile(metaPath, "utf8");
  expect(JSON.parse(meta).signer).toEqual(row.meta);

  for (const output of [quote.stdout, quote.stderr, paid.stdout, paid.stderr])
    for (const key of [testPrivateKey, testPrivateKey2]) {
      expect(output.text()).not.toContain(key.slice(2));
      expect(meta).not.toContain(key.slice(2));
    }
});

it.each([
  { name: "short flag", flag: "0xdeadbeef", env: undefined, source: "--private-key" },
  { name: "empty flag", flag: "", env: undefined, source: "--private-key" },
  {
    name: "unprefixed flag",
    flag: testPrivateKey2.slice(2),
    env: undefined,
    source: "--private-key",
  },
  {
    name: "out-of-range flag",
    flag: `0x${"f".repeat(64)}`,
    env: undefined,
    source: "--private-key",
  },
  {
    name: "invalid flag over env",
    flag: "0xdeadbeef",
    env: testPrivateKey,
    source: "--private-key",
  },
  { name: "short env", flag: undefined, env: "0xdeadbeef", source: "TEMPO_PRIVATE_KEY" },
  { name: "blank env", flag: undefined, env: " ", source: "TEMPO_PRIVATE_KEY" },
  { name: "padded env", flag: undefined, env: `${testPrivateKey}\n`, source: "TEMPO_PRIVATE_KEY" },
  { name: "zero env", flag: undefined, env: `0x${"0".repeat(64)}`, source: "TEMPO_PRIVATE_KEY" },
  { name: "non-hex env", flag: undefined, env: `0x${"g".repeat(64)}`, source: "TEMPO_PRIVATE_KEY" },
])("rejects an invalid $name before HTTP without echoing it", async (row) => {
  vi.stubEnv("TEMPO_PRIVATE_KEY", row.env);
  const server = await fixture();
  for (const dryRun of [true, false]) {
    const io = { stdout: capture(), stderr: capture() };
    // Mirror request-cli, which passes flag values (including empty ones) straight through.
    const error = await executeRequest(
      { ...requestOptions(server.url), dryRun, privateKey: row.flag },
      io,
    ).catch((e: unknown) => e);
    expectUsageError(
      error,
      `${row.source} must be a valid private key (0x followed by 64 hex characters)`,
    );
    expect(io.stdout.text()).toBe("");
    expect(io.stderr.text()).toBe("");
  }
  expect(server.requests()).toBe(0);
});

it.each([
  { name: "missing challenge", header: "", args: [] },
  { name: "malformed challenge", header: "Basic realm=local", args: [] },
  { name: "network mismatch", header: charge({ methodDetails: { chainId: 42431 } }), args: [] },
  { name: "expired challenge", header: charge({}, "2000-01-01T00:00:00Z"), args: [] },
  {
    name: "over max spend",
    header: charge({ amount: "6000", recipient: "0x0000000000000000000000000000000000000001" }),
    args: ["--max-spend", "0.001"],
    code: "E_LIMIT_EXCEEDED",
  },
])("announces no signer for an unusable 402 ($name)", async (row) => {
  const server = await fixture(row.header);
  const io = { stdout: capture(), stderr: capture() };
  await expect(
    runRequest(["--private-key", testPrivateKey2, ...row.args, server.url], io),
  ).rejects.toMatchObject({ code: row.code ?? "E_PAYMENT" });
  expect(io.stderr.text()).toBe("");
  expect(server.requests()).toBe(1);
});

it("keeps keys out of the actual CLI output", async () => {
  const home = await useTempHome();
  const server = await fixture();
  const cli = (...args: string[]) =>
    exec(process.execPath, [cliBundle("request"), ...args, server.url], {
      env: { ...process.env, TEMPO_PRIVATE_KEY: "", TEMPO_WALLET_NETWORK: "mainnet" },
    }).catch((error: { stdout: string; stderr: string; code: number }) => error);

  const paid = await cli("--private-key", testPrivateKey2);
  expect(paid.stderr).toBe(`${flagNotice}${flagWarning}`);
  expect(`${paid.stdout}${paid.stderr}`).not.toContain(testPrivateKey2.slice(2));

  // Structured output keeps stderr free of plain-text notices and attributes the payer in metadata.
  const metaPath = join(home, "meta.json");
  const structured = await cli("-j", "--private-key", testPrivateKey2, "--write-meta", metaPath);
  expect(JSON.parse(structured.stdout).source).toMatch(new RegExp(`${flagAddress}$`, "i"));
  expect(structured.stderr).toBe("");
  expect(JSON.parse(await readFile(metaPath, "utf8")).signer).toEqual(flagMeta);

  const invalid = `0x${"f".repeat(64)}`;
  const rejected = await cli("--private-key", invalid);
  expect(rejected).toMatchObject({ code: 2 });
  expect(`${rejected.stdout}${rejected.stderr}`).toContain(
    "--private-key must be a valid private key (0x followed by 64 hex characters)",
  );
  expect(`${rejected.stdout}${rejected.stderr}`).not.toContain(invalid.slice(2));
}, 30_000);

// A zero-amount charge is authorized with a signed proof, so no funds or RPC are involved.
function charge(request: Record<string, unknown> = {}, expires?: string) {
  return Challenge.serialize(
    Challenge.from({
      id: "private-key",
      realm: "local",
      method: "tempo",
      intent: "charge",
      ...(expires ? { expires } : {}),
      request: {
        amount: "0",
        currency: "0x20c0000000000000000000000000000000000000",
        methodDetails: { chainId: 4217 },
        ...request,
      },
    }),
  );
}

async function fixture(wwwAuthenticate = charge()) {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.headers.authorization) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ source: Credential.deserialize(req.headers.authorization).source }));
      return;
    }
    res.writeHead(402, wwwAuthenticate ? { "www-authenticate": wwwAuthenticate } : {});
    res.end("Payment Required");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return { url: `http://127.0.0.1:${address.port}`, requests: () => requests };
}

function requestOptions(url: string): RequestOptions {
  return { data: [], dataUrlencode: [], form: [], headers: [], paymentIntent: "auto", url };
}

function capture() {
  let text = "";
  return {
    write(chunk: string | Uint8Array) {
      text += Buffer.from(chunk).toString("utf8");
      return true;
    },
    text: () => text,
  };
}
