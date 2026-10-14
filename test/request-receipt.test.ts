import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";

import { Challenge, Credential, Receipt } from "mppx";
import { machineTokenDeployments, Session as TempoSession } from "mppx/tempo";
import { encodeFunctionResult, erc20Abi, toFunctionSelector, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  Abis as TempoAbis,
  Channel as TempoChannel,
  Transaction as TempoTransaction,
} from "viem/tempo";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { runRequest } from "../src/commands/request.js";
import { paymentReceipt, receiptSummary, receiptTxHash } from "../src/payment/receipt.js";
import { upsertSessionRecord, type PersistedSessionRecord } from "../src/payment/session-store.js";
import { parseNetwork } from "../src/shared/network.js";
import { cliBundle } from "./cli-bundle.js";
import {
  testAccessKey,
  testPrivateKey,
  testWallet,
  unlistedToken,
  usdc,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

const exec = promisify(execFile);

const { charge, onChain } = vi.hoisted(() => ({
  charge: { payload: undefined as Record<string, unknown> | undefined },
  onChain: { deposit: 0n },
}));

// Signing is replaced, so each credential names its action and the stored session's channel,
// or carries `charge.payload` when a test sets it.
vi.mock("mppx/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mppx/client")>();
  return {
    ...actual,
    Mppx: {
      ...actual.Mppx,
      create: () => ({
        onChallengeReceived: () => undefined,
        createCredential: async (response: Response, options?: { action?: string }) =>
          Credential.serialize({
            challenge: Challenge.fromResponseList(response)[0]!,
            payload: charge.payload ?? { action: options?.action ?? "open", channelId },
          }),
        transport: {
          setCredential: (init: RequestInit, credential: string) => {
            const headers = new Headers(init.headers);
            headers.set("authorization", credential);
            return { ...init, headers };
          },
        },
      }),
    },
  };
});

// A top-up transaction is signed without an RPC.
vi.mock("viem/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/actions")>();
  return {
    ...actual,
    prepareTransactionRequest: async (_client: unknown, parameters: object) => ({
      ...parameters,
      gas: 1n,
    }),
    signTransaction: async () => "0x76",
  };
});

const payee = "0x0000000000000000000000000000000000000001";
// The logged-in wallet's session, signed for by its access key.
const descriptor = {
  authorizedSigner: testAccessKey as Hex,
  expiringNonceHash: `0x${"3".repeat(64)}` as Hex,
  operator: "0x0000000000000000000000000000000000000000" as Hex,
  payee: payee as Hex,
  payer: testWallet as Hex,
  salt: `0x${"4".repeat(64)}` as Hex,
  token: usdc as Hex,
};
const channelId = TempoChannel.computeId(descriptor, { chainId: 4217 });
const txHash = `0x${"a".repeat(64)}`;
const topUpHash = `0x${"b".repeat(64)}`;
const keyPayer = privateKeyToAccount(testPrivateKey).address;
const mach = machineTokenDeployments[4217].token.toLowerCase();
const balanceOf = toFunctionSelector("balanceOf(address)");
const servers: ReturnType<typeof createServer>[] = [];

/** A charge credential payload whose transaction calls each of `targets`. */
async function signedCalls(...targets: string[]) {
  const signature = await TempoTransaction.serialize({
    type: "tempo",
    chainId: 4217,
    calls: targets.map((to) => ({ to: to as Hex, data: "0x" as Hex })),
    gas: 1n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    nonce: 0,
  } as never);
  return { type: "transaction", signature };
}

// A machine-enabled charge the SDK settled through the MACH route, and one it paid directly.
const machRoute = await signedCalls(mach, machineTokenDeployments[4217].swap);
const directTransfer = await signedCalls(usdc);

beforeEach(() => {
  charge.payload = undefined;
  vi.stubEnv("TEMPO_MAX_SPEND", "");
  vi.stubEnv("TEMPO_PRIVATE_KEY", "");
  vi.stubEnv("TEMPO_WALLET_NETWORK", "mainnet");
});

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

function offer(
  intent: "charge" | "session" | "subscription",
  request: Record<string, unknown> = {},
) {
  return Challenge.from({
    id: `receipt-${intent}`,
    realm: "local",
    method: "tempo",
    intent,
    request: {
      amount: "10000",
      currency: usdc,
      recipient: payee,
      methodDetails: { chainId: 4217, ...(intent === "session" ? { sessionProtocol: "v2" } : {}) },
      ...request,
    },
  });
}

function chargeReceipt(reference: string) {
  return Receipt.serialize(
    Receipt.from({
      method: "tempo",
      reference,
      status: "success",
      timestamp: new Date().toISOString(),
    }),
  );
}

function sessionReceipt(cumulative: bigint, hash?: string) {
  return TempoSession.Precompile.Receipt.serializeSessionReceipt(
    TempoSession.Precompile.Receipt.createSessionReceipt({
      challengeId: "receipt-session",
      channelId,
      acceptedCumulative: cumulative,
      spent: cumulative,
      ...(hash ? { txHash: hash as Hex } : {}),
    }),
  );
}

async function listen(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return `http://127.0.0.1:${address.port}`;
}

/**
 * A 402 service for `challenge`. A paid request gets `paidStatus` and the body "paid", with
 * `receipt` as its Payment-Receipt. With `topUp`, the first voucher is refused for its deposit and
 * the top-up answered with a receipt naming `topUpHash`. `/rpc` answers balance and channel reads,
 * the channel holding `onChain.deposit`.
 */
async function service(options: {
  challenge: Challenge.Challenge;
  receipt?: string | undefined;
  paidStatus?: number | undefined;
  topUp?: { required: bigint; accepted: bigint } | undefined;
}) {
  let refused = false;
  const origin = await listen(async (req, res) => {
    if (req.url === "/rpc") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const call = JSON.parse(body) as { id: number; params: [{ data: Hex }] };
      const result = call.params[0].data.startsWith(balanceOf)
        ? encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: 10n ** 12n })
        : encodeFunctionResult({
            abi: TempoAbis.tip20ChannelReserve,
            functionName: "getChannelState",
            result: { settled: 0n, deposit: onChain.deposit, closeRequestedAt: 0 },
          });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
      return;
    }
    if (!req.headers.authorization) {
      res.writeHead(402, { "www-authenticate": Challenge.serialize(options.challenge) });
      res.end("Payment Required");
      return;
    }
    const { action } = Credential.deserialize<{ action?: string }>(
      req.headers.authorization,
    ).payload;
    if (options.topUp && action === "topUp") {
      res.writeHead(200, { "payment-receipt": sessionReceipt(options.topUp.accepted, topUpHash) });
      res.end();
      return;
    }
    if (options.topUp && !refused) {
      refused = true;
      res.writeHead(402, { "content-type": "application/problem+json" });
      res.end(
        JSON.stringify({
          title: "Insufficient deposit",
          requiredTopUp: options.topUp.required.toString(),
        }),
      );
      return;
    }
    res.writeHead(
      options.paidStatus ?? 200,
      options.receipt ? { "payment-receipt": options.receipt } : {},
    );
    res.end("paid");
  });
  vi.stubEnv("TEMPO_RPC_URL", `${origin}/rpc`);
  return origin;
}

/** The wallet's reusable session on `channelId` for `origin`. */
function storeSession(origin: string, overrides: Partial<PersistedSessionRecord> = {}) {
  return upsertSessionRecord({
    accepted_cumulative: 0n,
    authorized_signer: testAccessKey.toLowerCase(),
    chain_id: 4217,
    challenge_echo: "{}",
    channel_id: channelId,
    close_requested_at: 0,
    created_at: 1,
    cumulative_amount: 0n,
    deposit: 1_000_000n,
    descriptor_json: JSON.stringify(descriptor),
    escrow_contract: TempoChannel.address.toLowerCase(),
    grace_ready_at: 0,
    last_used_at: 1,
    network: "tempo",
    origin,
    payee,
    payer: testWallet.toLowerCase(),
    request_url: `${origin}/paid`,
    salt: "0x00",
    server_spent: 0n,
    session_protocol: "v2",
    state: "active",
    token: usdc.toLowerCase(),
    ...overrides,
  });
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

const close = ["tempo", "wallet", "sessions", "close", channelId, "--network", "mainnet"];
// A charge of 0.01 USDC.e from the logged-in wallet.
const charged = {
  intent: "charge",
  amount: "0.01",
  token: usdc.toLowerCase(),
  symbol: "USDC.e",
  decimals: 6,
  tx_hash: null,
  session: null,
  channel_id: null,
  deposit_locked: null,
  cumulative: null,
  subscription: null,
  payer: testWallet,
  chain_id: 4217,
  network: "tempo",
};
const session = { ...charged, intent: "session", channel_id: channelId };

it.each<{
  name: string;
  challenge: Challenge.Challenge;
  args?: string[];
  receipt?: string;
  stored?: Partial<PersistedSessionRecord>;
  topUp?: { required: bigint; accepted: bigint };
  privateKey?: boolean;
  payload?: Record<string, unknown>;
  payment: Record<string, unknown>;
  stderr: string;
}>([
  {
    name: "a charge with the server's transaction hash",
    challenge: offer("charge"),
    receipt: chargeReceipt(txHash),
    payment: { ...charged, tx_hash: txHash },
    stderr: `Paid 0.01 USDC.e · tx ${txHash}\n`,
  },
  {
    name: "a pushed charge, keeping its own hash over the server's",
    challenge: offer("charge"),
    payload: { type: "hash", hash: txHash },
    receipt: chargeReceipt(topUpHash),
    payment: { ...charged, tx_hash: txHash },
    stderr: `Paid 0.01 USDC.e · tx ${txHash}\n`,
  },
  {
    name: "a charge without a Payment-Receipt",
    challenge: offer("charge"),
    payment: charged,
    stderr: "Paid 0.01 USDC.e\n",
  },
  {
    name: "a MACH settlement, which debits MACH",
    challenge: offer("charge", { methodDetails: { chainId: 4217, machineTokenEnabled: true } }),
    args: ["--mach", "--max-spend", "1"],
    receipt: chargeReceipt(txHash),
    payment: { ...charged, token: mach, symbol: "MACH", tx_hash: txHash },
    stderr: `Paid 0.01 MACH · tx ${txHash}\n`,
  },
  {
    name: "a machine-enabled charge the SDK settled from MACH without --mach",
    challenge: offer("charge", { methodDetails: { chainId: 4217, machineTokenEnabled: true } }),
    payload: machRoute,
    payment: { ...charged, token: mach, symbol: "MACH" },
    stderr: "Paid 0.01 MACH\n",
  },
  {
    name: "a machine-enabled charge the SDK paid in the offered token",
    challenge: offer("charge", { methodDetails: { chainId: 4217, machineTokenEnabled: true } }),
    payload: directTransfer,
    payment: charged,
    stderr: "Paid 0.01 USDC.e\n",
  },
  {
    name: "a subscription, as a recurring authorization rather than a payment",
    challenge: offer("subscription", {
      amount: "25000000",
      periodCount: "1",
      periodUnit: "week",
      subscriptionExpires: "2027-01-01T00:00:00.000Z",
    }),
    payment: {
      ...charged,
      intent: "subscription",
      amount: "25",
      subscription: { period: "1 week", expires: "2027-01-01T00:00:00.000Z" },
    },
    stderr:
      "Authorized a subscription of up to 25 USDC.e every 1 week until 2027-01-01T00:00:00.000Z\n",
  },
  {
    name: "a private-key payer",
    challenge: offer("charge"),
    privateKey: true,
    payment: { ...charged, payer: keyPayer },
    stderr: `Paying with key from TEMPO_PRIVATE_KEY (${keyPayer}), not the logged-in wallet\nPaid 0.01 USDC.e\n`,
  },
  {
    name: "a new session, naming the close that requests its deposit back",
    challenge: offer("session", { suggestedDeposit: "1000000" }),
    receipt: sessionReceipt(10_000n, txHash),
    payment: {
      ...session,
      tx_hash: txHash,
      session: "open",
      deposit_locked: "1",
      cumulative: "0.01",
      // The close only requests it; the deposit is withdrawn by a rerun after the grace period.
      instruction: `Session ${channelId} keeps 1 USDC.e locked until it is closed. When you are done with this service, run the next command to request its close, then follow that command's _next to withdraw the unspent deposit once the close grace period ends.`,
      _next: { argv: close, command: close.join(" ") },
    },
    stderr: `Paid 0.01 USDC.e · opened a session with 1 USDC.e locked\nWhen done, request its close, then rerun after the grace period to withdraw the unspent deposit: ${close.join(" ")}\n`,
  },
  {
    name: "a reused session's voucher, as signed rather than as the server reports spent",
    challenge: offer("session"),
    stored: { cumulative_amount: 50_000n },
    receipt: sessionReceipt(10_000n),
    payment: { ...session, session: "reuse", deposit_locked: "1", cumulative: "0.06" },
    stderr: `Paid 0.01 USDC.e · session ${channelId} (0.06 of 1 USDC.e deposit in signed vouchers)\n`,
  },
  {
    name: "a reused session topped up for its voucher",
    challenge: offer("session"),
    stored: { cumulative_amount: 995_000n },
    topUp: { required: 500_000n, accepted: 995_000n },
    payment: {
      ...session,
      tx_hash: topUpHash,
      session: "reuse",
      deposit_locked: "1.5",
      cumulative: "1.005",
    },
    stderr: `Paid 0.01 USDC.e · session ${channelId} (1.005 of 1.5 USDC.e deposit in signed vouchers)\n`,
  },
])("reports the receipt of $name", async (row) => {
  const home = await useTempHome();
  await writeWalletState(walletState());
  if (row.privateKey) vi.stubEnv("TEMPO_PRIVATE_KEY", testPrivateKey);
  charge.payload = row.payload;
  onChain.deposit = row.stored ? 1_000_000n : 0n;
  const origin = await service({
    challenge: row.challenge,
    receipt: row.receipt,
    topUp: row.topUp,
  });
  if (row.stored) await storeSession(origin, row.stored);
  const meta = join(home, "meta.json");
  const io = { stdout: capture(), stderr: capture() };

  await runRequest([...(row.args ?? []), "--write-meta", meta, `${origin}/paid`], io);

  expect(io.stdout.text()).toBe("paid");
  expect(io.stderr.text()).toBe(row.stderr);
  expect(JSON.parse(await readFile(meta, "utf8")).payment).toEqual(row.payment);
});

it.each<{
  name: string;
  challenge?: Challenge.Challenge;
  status?: number;
  receipt?: string;
  code?: string;
}>([
  { name: "an unpaid request" },
  { name: "a zero-amount proof", challenge: offer("charge", { amount: "0" }) },
  {
    name: "a paid request answered with an HTTP error",
    challenge: offer("charge"),
    status: 500,
    code: "E_HTTP",
  },
  {
    name: "a session whose server receipt cannot be stored",
    challenge: offer("session"),
    receipt: "not-a-valid-receipt",
    code: "E_PAYMENT_OUTCOME_UNKNOWN",
  },
])("reports no receipt for $name", async ({ challenge, status, receipt, code }) => {
  const home = await useTempHome();
  await writeWalletState(walletState());
  const origin = challenge
    ? await service({ challenge, paidStatus: status, receipt: receipt ?? chargeReceipt(txHash) })
    : await listen((_req, res) => res.end("paid"));
  const meta = join(home, "meta.json");
  const io = { stdout: capture(), stderr: capture() };

  const result = runRequest(["--write-meta", meta, `${origin}/paid`], io);

  if (code) await expect(result).rejects.toMatchObject({ code });
  else await result;
  expect(io.stdout.text()).toBe("paid");
  expect(io.stderr.text()).toBe("");
  expect(JSON.parse(await readFile(meta, "utf8"))).not.toHaveProperty("payment");
});

it("marks the --write-meta receipt unconfirmed when the paid body fails to arrive", async () => {
  const home = await useTempHome();
  await writeWalletState(walletState());
  const origin = await listen((req, res) => {
    if (!req.headers.authorization) {
      res.writeHead(402, { "www-authenticate": Challenge.serialize(offer("charge")) });
      res.end("Payment Required");
      return;
    }
    res.writeHead(200, { "payment-receipt": chargeReceipt(txHash) });
    res.flushHeaders();
    setTimeout(() => res.destroy(), 10);
  });
  const meta = join(home, "meta.json");
  const stderr = capture();

  await expect(
    runRequest(["--write-meta", meta, `${origin}/paid`], { stdout: capture(), stderr }),
  ).rejects.toMatchObject({ code: "E_PAYMENT_OUTCOME_UNKNOWN" });
  expect(stderr.text()).toBe("");
  expect(JSON.parse(await readFile(meta, "utf8")).payment).toEqual({
    ...charged,
    tx_hash: txHash,
    outcome: "unknown",
  });
});

// The actual CLI signs a voucher for the stored session, so this runs without mocks.
it("keeps structured stderr empty and reports the receipt through --write-meta", async () => {
  const home = await useTempHome();
  onChain.deposit = 1_000_000n;
  const origin = await service({ challenge: offer("session") });
  const meta = join(home, "meta.json");
  const cli = async (...args: string[]) => {
    await useTempHome();
    await writeWalletState(walletState());
    await storeSession(origin);
    return exec(process.execPath, [cliBundle("request"), ...args, `${origin}/paid`], {
      env: { ...process.env, TEMPO_RPC_URL: `${origin}/rpc` },
    });
  };
  const payment = { ...session, session: "reuse", deposit_locked: "1", cumulative: "0.01" };

  const human = await cli("--write-meta", meta);
  expect(human.stdout).toBe("paid");
  expect(human.stderr).toBe(
    `Paid 0.01 USDC.e · session ${channelId} (0.01 of 1 USDC.e deposit in signed vouchers)\n`,
  );
  expect(JSON.parse(await readFile(meta, "utf8")).payment).toEqual(payment);

  for (const format of [["-j"], ["--format", "json"]]) {
    const structured = await cli(...format, "--write-meta", meta);
    expect(structured.stdout).toBe("paid");
    expect(structured.stderr).toBe("");
    expect(JSON.parse(await readFile(meta, "utf8")).payment).toEqual(payment);
  }
}, 30_000);

const network = parseNetwork("mainnet");
// Invisible characters a server could put in its strings, and how the receipt shows them.
const rlo = String.fromCodePoint(0x202e);
const zwsp = String.fromCodePoint(0x200b);

it.each([
  {
    name: "a charge in an unlisted token",
    payment: { intent: "charge", amount: 6000n, token: unlistedToken },
    receipt: { token: unlistedToken, symbol: null, decimals: null },
    stderr: `Paid 0.006 ${unlistedToken}\n`,
  },
  {
    name: "a session on an unlisted channel with invisible characters",
    payment: {
      intent: `session${rlo}`,
      amount: 6000n,
      token: `${usdc}${zwsp}`,
      session: { channelId: `${channelId}${rlo}`, deposit: 0n, cumulative: 6000n, reused: true },
    },
    receipt: {
      intent: "session\\u202e",
      token: `${usdc.toLowerCase()}\\u200b`,
      symbol: null,
      channel_id: `${channelId}\\u202e`,
    },
    stderr: `Paid 0.006 ${usdc.toLowerCase()}\\u200b · session ${channelId}\\u202e (0.006 of 0 ${usdc.toLowerCase()}\\u200b deposit in signed vouchers)\n`,
  },
  {
    name: "a subscription with invisible characters in its terms",
    payment: {
      intent: "subscription",
      amount: 6000n,
      token: usdc,
      subscription: { period: `1 week${rlo}`, expires: `2027-01-01T00:00:00.000Z${zwsp}` },
    },
    receipt: {
      subscription: { period: "1 week\\u202e", expires: "2027-01-01T00:00:00.000Z\\u200b" },
    },
    stderr:
      "Authorized a subscription of up to 0.006 USDC.e every 1 week\\u202e until 2027-01-01T00:00:00.000Z\\u200b\n",
  },
])("builds the receipt of $name", ({ payment, receipt, stderr }) => {
  const built = paymentReceipt({ ...payment, network, payer: testWallet, txHash: null });
  expect(built).toMatchObject(receipt);
  expect(receiptSummary(built)).toBe(stderr);
});

it.each([
  { name: "a charge reference", intent: "charge", header: chargeReceipt(txHash), hash: txHash },
  { name: "a session txHash", intent: "session", header: sessionReceipt(1n, txHash), hash: txHash },
  { name: "a session reference", intent: "session", header: sessionReceipt(1n), hash: null },
  { name: "a short reference", intent: "charge", header: chargeReceipt("0x1234"), hash: null },
  {
    name: "a reference with invisible characters",
    intent: "charge",
    header: chargeReceipt(`${txHash}${rlo}`),
    hash: null,
  },
  { name: "a malformed header", intent: "charge", header: "not-base64-json", hash: null },
])("reads the transaction hash from $name", ({ intent, header, hash }) => {
  const response = new Response(null, { headers: { "payment-receipt": header } });
  expect(receiptTxHash(response, intent)).toBe(hash);
});
