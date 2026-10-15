import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Challenge } from "mppx";
import { Mppx } from "mppx/client";
import { machineTokenDeployments } from "mppx/tempo";
import { encodeFunctionResult, erc20Abi, toFunctionSelector, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Abis as TempoAbis, Channel as TempoChannel } from "viem/tempo";
import { afterEach, expect, it, vi } from "vitest";

import { runRequest } from "../src/request/run.js";
import {
  readSessionRecordsByOrigin,
  upsertSessionRecord,
  type PersistedSessionRecord,
} from "../src/payment/session-store.js";
import { requestDryRunOutput } from "../src/schemas/request.js";
import { readTokenMetadata } from "../src/shared/tokens.js";
import type { WalletState } from "../src/wallet/store.js";
import { cliBundle } from "./cli-bundle.js";
import {
  ousdToken,
  testAccessKey,
  testPrivateKey,
  testWallet,
  unlistedToken,
  usdc,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

vi.mock("mppx/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mppx/client")>();
  return { ...actual, Mppx: { ...actual.Mppx } };
});

vi.mock("../src/shared/tokens.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/tokens.js")>();
  return { ...actual, readTokenMetadata: vi.fn(actual.readTokenMetadata) };
});

const exec = promisify(execFile);
const body = "server-body-must-not-leak";
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

// No wallet is logged in, so nothing about a payer is known; the default cap applies.
const quote = {
  payment_required: true,
  method: "tempo",
  intent: "charge",
  recurring: false,
  amount: "0.006",
  amount_raw: "6000",
  session: null,
  deposit: null,
  deposit_raw: null,
  token: "0x20c0000000000000000000000000000000000000",
  symbol: "pathUSD",
  decimals: 6,
  balance: null,
  access_key_limit: null,
  machine_token_enabled: false,
  payment_token: null,
  chain_id: 4217,
  max_spend: "10",
  within_budget: true,
  signer: { address: null, source: "wallet" },
};

// Without a logged-in wallet, the quote also points at the login that lets it pay.
const loginNext = {
  instruction:
    "No wallet is logged in. Run the next command, then rerun this request without --dry-run to pay.",
  _next: {
    argv: ["tempo", "wallet", "login", "--network", "mainnet"],
    command: "tempo wallet login --network mainnet",
  },
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
  if (status === 402) return { ...quote, ...loginNext };
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

const recipient = "0x0000000000000000000000000000000000000001";
const storedChannel = `0x${"1".repeat(64)}`;
const newerChannel = `0x${"2".repeat(64)}`;
const machToken = machineTokenDeployments[4217].token.toLowerCase();
// Raw balances by token: 7 MACH and 1 of an 18-decimal unlisted token; any other token holds 5.
const balances: Record<string, bigint> = {
  [machToken]: 7_000_000n,
  [unlistedToken]: 10n ** 18n,
};
const balanceOf = toFunctionSelector("balanceOf(address)");
const getChannelState = toFunctionSelector("getChannelState(bytes32)");

type Read = "ok" | "error" | "stall";

function offer(
  intent: "charge" | "session" | "subscription",
  request: Record<string, unknown> = {},
) {
  return Challenge.from({
    id: `spend-${intent}`,
    realm: "local",
    method: "tempo",
    intent,
    request: {
      amount: "6000",
      currency: usdc,
      recipient,
      methodDetails: { chainId: 4217, ...(intent === "session" ? { sessionProtocol: "v2" } : {}) },
      ...request,
    },
  });
}

async function listen(server: ReturnType<typeof createServer>) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return `http://127.0.0.1:${address.port}`;
}

/** Answers balance and v2 channel reads, recording every JSON-RPC method it is sent. */
async function rpcFixture(options: { balance: Read; channels: Read; closed: string[] }) {
  const methods: string[] = [];
  const url = await listen(
    createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const call = JSON.parse(Buffer.concat(chunks).toString()) as {
        id: number;
        method: string;
        params: [{ to: string; data: Hex }];
      };
      methods.push(call.method);
      const reply = (result?: Hex) =>
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: call.id,
            ...(result ? { result } : { error: { code: -32000, message: "unavailable" } }),
          }),
        );
      const { to, data } = call.params[0];
      const read = data.startsWith(balanceOf)
        ? options.balance
        : data.startsWith(getChannelState)
          ? options.channels
          : "error";
      if (read === "stall") return;
      if (read === "error") return reply();
      if (data.startsWith(balanceOf))
        return reply(
          encodeFunctionResult({
            abi: erc20Abi,
            functionName: "balanceOf",
            result: balances[to.toLowerCase()] ?? 5_000_000n,
          }),
        );
      reply(
        encodeFunctionResult({
          abi: TempoAbis.tip20ChannelReserve,
          functionName: "getChannelState",
          result: {
            settled: 0n,
            deposit: 1_000_000n,
            closeRequestedAt: options.closed.includes(`0x${data.slice(10)}`) ? 1 : 0,
          },
        }),
      );
    }),
  );
  return { methods, url };
}

/** Answers every request with `challenge`, counting any that carry a credential. */
async function paymentService(challenge: Challenge.Challenge) {
  let authorized = 0;
  const url = await listen(
    createServer((req, res) => {
      if (req.headers.authorization) authorized++;
      res.writeHead(402, { "www-authenticate": Challenge.serialize(challenge) });
      res.end(body);
    }),
  );
  return { url, authorized: () => authorized };
}

function sessionRecord(
  origin: string,
  overrides: Partial<PersistedSessionRecord> = {},
): PersistedSessionRecord {
  return {
    accepted_cumulative: 0n,
    authorized_signer: testAccessKey,
    chain_id: 4217,
    challenge_echo: "{}",
    channel_id: storedChannel,
    close_requested_at: 0,
    created_at: 1,
    cumulative_amount: 0n,
    deposit: 1_000_000n,
    descriptor_json: "{}",
    escrow_contract: TempoChannel.address,
    grace_ready_at: 0,
    last_used_at: 1,
    network: "tempo",
    origin,
    payee: recipient,
    payer: testWallet,
    request_url: `${origin}/`,
    salt: "0x00",
    server_spent: 0n,
    session_protocol: "v2",
    state: "active",
    token: usdc,
    ...overrides,
  };
}

// The logged-in wallet holds 5 USDC.e (7 MACH), and its key has a stored 100 USDC.e limit.
const quoted = {
  ...quote,
  token: usdc,
  symbol: "USDC.e",
  balance: "5",
  access_key_limit: "100",
};
const session = { intent: "session" };
const opened = { ...session, session: "open", deposit: "0.006", deposit_raw: "6000" };
const reused = { ...session, session: "reuse", deposit: "0", deposit_raw: "0" };
const capped = { max_spend: "1" };

it.each<{
  name: string;
  challenge: Challenge.Challenge;
  args?: string[];
  stored?: Partial<PersistedSessionRecord>[];
  closed?: string[];
  balance?: Read;
  channels?: Read;
  wallet?: boolean;
  key?: Partial<WalletState["accessKeys"][number]>;
  metadata?: { decimals: number; symbol: string };
  privateKey?: boolean;
  env?: Record<string, string>;
  expected: Record<string, unknown>;
}>([
  { name: "a charge under the default cap", challenge: offer("charge"), expected: {} },
  {
    name: "a charge under an explicit cap",
    challenge: offer("charge"),
    args: ["--max-spend", "1"],
    expected: capped,
  },
  {
    name: "a charge under TEMPO_MAX_SPEND",
    challenge: offer("charge"),
    env: { TEMPO_MAX_SPEND: "2" },
    expected: { max_spend: "2" },
  },
  {
    name: "a subscription, which no default cap bounds",
    challenge: offer("subscription", { amount: "25000000" }),
    expected: {
      intent: "subscription",
      recurring: true,
      amount: "25",
      amount_raw: "25000000",
      max_spend: null,
      within_budget: null,
    },
  },
  {
    name: "a new session at one call without a suggested deposit",
    challenge: offer("session"),
    expected: opened,
  },
  {
    name: "a new session at the suggested deposit",
    challenge: offer("session", { suggestedDeposit: "2000000" }),
    expected: { ...opened, deposit: "2", deposit_raw: "2000000" },
  },
  {
    name: "a new session deposit lowered to the default cap",
    challenge: offer("session", { suggestedDeposit: "25000000" }),
    expected: { ...opened, deposit: "10", deposit_raw: "10000000" },
  },
  {
    name: "a new session deposit lowered to an explicit cap",
    challenge: offer("session", { suggestedDeposit: "2000000" }),
    args: ["--max-spend", "1"],
    expected: { ...opened, ...capped, deposit: "1", deposit_raw: "1000000" },
  },
  {
    name: "a reused session under the default cap",
    challenge: offer("session"),
    stored: [{}],
    expected: reused,
  },
  {
    name: "a reused session under an explicit cap",
    challenge: offer("session"),
    stored: [{ cumulative_amount: 100_000n }],
    args: ["--max-spend", "1"],
    expected: { ...reused, ...capped },
  },
  {
    name: "a reused session whose voucher needs a top-up",
    challenge: offer("session"),
    stored: [{ cumulative_amount: 999_000n }],
    expected: { ...reused, deposit: "0.005", deposit_raw: "5000" },
  },
  {
    name: "a top-up measured against the on-chain deposit",
    challenge: offer("session"),
    stored: [{ cumulative_amount: 999_000n, deposit: 500_000n }],
    expected: { ...reused, deposit: "0.005", deposit_raw: "5000" },
  },
  {
    name: "a reused session whose cumulative spend exceeds an explicit cap",
    challenge: offer("session"),
    stored: [{ cumulative_amount: 999_000n }],
    args: ["--max-spend", "1"],
    expected: { ...reused, ...capped, deposit: "0.005", deposit_raw: "5000", within_budget: false },
  },
  {
    name: "a reused session whose cumulative spend exceeds the default cap",
    challenge: offer("session"),
    stored: [{ cumulative_amount: 9_999_000n }],
    expected: { ...reused, deposit: "9.005", deposit_raw: "9005000", within_budget: false },
  },
  {
    name: "a new session when the stored one is closing on chain",
    challenge: offer("session"),
    stored: [{}],
    closed: [storedChannel],
    expected: opened,
  },
  {
    name: "a reused session after skipping a newer one without its descriptor",
    challenge: offer("session"),
    stored: [{}, { channel_id: newerChannel, descriptor_json: undefined, last_used_at: 2 }],
    expected: reused,
  },
  {
    name: "a MACH charge against the MACH balance",
    challenge: offer("charge", { methodDetails: { chainId: 4217, machineTokenEnabled: true } }),
    args: ["--mach"],
    expected: {
      machine_token_enabled: true,
      payment_token: "MACH",
      balance: "7",
      access_key_limit: null,
    },
  },
  {
    name: "a private-key payer without an access key limit",
    challenge: offer("charge"),
    privateKey: true,
    expected: {
      access_key_limit: null,
      signer: { address: privateKeyToAccount(testPrivateKey).address, source: "env" },
    },
  },
  {
    name: "no payer without a logged-in wallet",
    challenge: offer("session"),
    args: ["--max-spend", "1"],
    wallet: false,
    expected: {
      ...session,
      ...capped,
      balance: null,
      access_key_limit: null,
      within_budget: null,
      ...loginNext,
    },
  },
  {
    name: "a failed balance read",
    challenge: offer("charge"),
    balance: "error",
    expected: { balance: null },
  },
  {
    name: "a stalled balance read",
    challenge: offer("charge"),
    balance: "stall",
    expected: { balance: null },
  },
  {
    name: "a failed session read",
    challenge: offer("session"),
    stored: [{}],
    channels: "error",
    args: ["--max-spend", "1"],
    expected: { ...session, ...capped, within_budget: null },
  },
  {
    name: "unreadable metadata for an unlisted token",
    challenge: offer("charge", { currency: unlistedToken }),
    expected: {
      token: unlistedToken,
      symbol: null,
      decimals: null,
      balance: null,
      access_key_limit: null,
    },
  },
  {
    name: "an unlisted token in its own decimals without its self-declared ticker",
    challenge: offer("charge", { currency: unlistedToken }),
    metadata: { decimals: 18, symbol: "USDC.e" },
    key: { limits: [{ token: unlistedToken, limit: `${10n ** 18n}#__bigint` }] },
    expected: {
      token: unlistedToken,
      symbol: null,
      decimals: 18,
      balance: "1",
      access_key_limit: "1",
    },
  },
  {
    name: "a zero limit for a token exact stored limits leave out",
    challenge: offer("charge"),
    key: { permissionSemantics: 1, limits: [{ token: ousdToken, limit: "1000000#__bigint" }] },
    expected: { access_key_limit: "0" },
  },
  {
    name: "no limit for an unrestricted key",
    challenge: offer("charge"),
    key: { permissionSemantics: 1, limits: undefined },
    expected: { access_key_limit: null },
  },
])("quotes $name without signing or writing", async (row) => {
  await useTempHome();
  if (row.wallet !== false)
    await writeWalletState(
      walletState({ accessKeys: [{ ...walletState().accessKeys[0]!, ...row.key }] }),
    );
  if (row.metadata) vi.mocked(readTokenMetadata).mockResolvedValueOnce(row.metadata);
  const rpc = await rpcFixture({
    balance: row.balance ?? "ok",
    channels: row.channels ?? "ok",
    closed: row.closed ?? [],
  });
  const service = await paymentService(row.challenge);
  vi.stubEnv("TEMPO_MAX_SPEND", row.env?.TEMPO_MAX_SPEND ?? "");
  vi.stubEnv("TEMPO_PRIVATE_KEY", row.privateKey ? testPrivateKey : "");
  vi.stubEnv("TEMPO_RPC_URL", rpc.url);
  vi.stubEnv("TEMPO_WALLET_NETWORK", "mainnet");
  for (const record of row.stored ?? [])
    await upsertSessionRecord(sessionRecord(service.url, record));
  const create = vi.spyOn(Mppx, "create");
  let stdout = "";
  const write = (chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  };

  await runRequest(["--dry-run", ...(row.args ?? []), service.url], { stdout: { write } });

  const output = JSON.parse(stdout) as unknown;
  expect(output).toEqual({ ...quoted, ...row.expected });
  expect(requestDryRunOutput.parse(output)).toEqual(output);
  expect(create).not.toHaveBeenCalled();
  expect(service.authorized()).toBe(0);
  expect(rpc.methods.filter((method) => method !== "eth_call")).toEqual([]);
  // Stale stored sessions are left for the payment to delete.
  expect(await readSessionRecordsByOrigin(service.url)).toHaveLength(row.stored?.length ?? 0);
});

it.each([
  { cap: "an explicit", amount: "6000", args: ["--max-spend", "0.001"], max: "0.001" },
  { cap: "the default", amount: "25000000", args: [], max: "10 (default)" },
])("refuses a charge over $cap cap as the payment would", async ({ amount, args, max }) => {
  await useTempHome();
  await writeWalletState(walletState());
  const service = await paymentService(offer("charge", { amount }));
  vi.stubEnv("TEMPO_MAX_SPEND", "");
  vi.stubEnv("TEMPO_PRIVATE_KEY", "");
  vi.stubEnv("TEMPO_WALLET_NETWORK", "mainnet");

  await expect(
    runRequest(["--dry-run", ...args, service.url], { stdout: { write: () => true } }),
  ).rejects.toMatchObject({
    code: "E_LIMIT_EXCEEDED",
    message: expect.stringContaining(`max spend exceeded: max=${max}`),
  });
  expect(service.authorized()).toBe(0);
});
