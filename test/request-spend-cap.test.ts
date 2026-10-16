import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { Challenge, Credential } from "mppx";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionResult } from "viem";
import { Abis as TempoAbis, Channel as TempoChannel } from "viem/tempo";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { runRequest } from "../src/request/run.js";
import { MaxSpendExceededError } from "../src/request/spend.js";
import { readSessionRecordsByOrigin, upsertSessionRecord } from "../src/payment/session-store.js";
import { saveConfigValue } from "../src/wallet/config.js";
import { cliBundle } from "./cli-bundle.js";
import { testPrivateKey, useTempHome } from "./helpers.js";

const exec = promisify(execFile);

const { credentialOptions, onChain } = vi.hoisted(() => ({
  credentialOptions: [] as unknown[],
  onChain: { deposit: 0n },
}));

// Signing is replaced so a test can see whether, and with what deposit, a credential was made.
vi.mock("mppx/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mppx/client")>();
  return {
    ...actual,
    Mppx: {
      ...actual.Mppx,
      create: () => ({
        onChallengeReceived: () => undefined,
        createCredential: async (response: Response, options?: unknown) => {
          credentialOptions.push(options);
          return Credential.serialize({
            challenge: Challenge.fromResponseList(response)[0]!,
            payload: { channelId },
          });
        },
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

vi.mock("viem/tempo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem/tempo")>();
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      token: { ...actual.Actions.token, getBalance: async () => ({ amount: 1_000_000_000n }) },
    },
  };
});

vi.mock("../src/shared/network.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/network.js")>();
  return {
    ...actual,
    createTempoPublicClient: () => ({
      readContract: async () => ({ deposit: onChain.deposit, settled: 0n, closeRequestedAt: 0n }),
    }),
  };
});

const channelId = `0x${"1".repeat(64)}`;
const payer = privateKeyToAccount(testPrivateKey).address.toLowerCase();
const payee = "0x0000000000000000000000000000000000000001";
const token = "0x20c0000000000000000000000000000000000000";
const servers: ReturnType<typeof createServer>[] = [];

beforeEach(() => {
  vi.stubEnv("TEMPO_PRIVATE_KEY", testPrivateKey);
  vi.stubEnv("TEMPO_WALLET_NETWORK", "mainnet");
  vi.stubEnv("TEMPO_MAX_SPEND", "");
  // The stubbed public client reads the chain, so no RPC override needs a chain check.
  vi.stubEnv("TEMPO_RPC_URL", undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  credentialOptions.length = 0;
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

/**
 * A 402 service, also offering a one-time `charge` when set; a paid request gets `paidStatus`
 * and `paidBody`. Its `/rpc` reports a channel holding `onChain.deposit`.
 */
async function service(options: {
  intent: string;
  amount: string;
  charge?: string | undefined;
  suggestedDeposit?: string | undefined;
  paidStatus?: number | undefined;
  paidBody?: string | undefined;
}) {
  const seen: boolean[] = [];
  const offer = (intent: string, amount: string) =>
    Challenge.serialize(
      Challenge.from({
        id: `spend-cap-${intent}`,
        realm: "local",
        method: "tempo",
        intent,
        request: {
          amount,
          currency: token,
          recipient: payee,
          methodDetails: {
            chainId: 4217,
            ...(intent === "session" ? { sessionProtocol: "v2" } : {}),
          },
          ...(options.suggestedDeposit ? { suggestedDeposit: options.suggestedDeposit } : {}),
        },
      }),
    );
  const header = [
    offer(options.intent, options.amount),
    ...(options.charge ? [offer("charge", options.charge)] : []),
  ].join(", ");
  const server = createServer(async (req, res) => {
    if (req.url === "/rpc") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { id, method } = JSON.parse(body) as { id: number; method: string };
      // The RPC is on mainnet, so a session read passes the TEMPO_RPC_URL check.
      const result =
        method === "eth_chainId"
          ? "0x1079"
          : encodeFunctionResult({
              abi: TempoAbis.tip20ChannelReserve,
              functionName: "getChannelState",
              result: { settled: 0n, deposit: onChain.deposit, closeRequestedAt: 0 },
            });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      return;
    }
    seen.push(Boolean(req.headers.authorization));
    if (!req.headers.authorization) {
      res.writeHead(402, { "www-authenticate": header });
      res.end("Payment Required");
      return;
    }
    res.writeHead(options.paidStatus ?? 200);
    res.end(options.paidBody ?? "paid");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  return { origin: `http://127.0.0.1:${address.port}`, seen };
}

async function run(args: string[], url: string) {
  let stdout = "";
  await runRequest([...args, url], {
    stdout: {
      write: ((chunk: string | Uint8Array) => {
        stdout += chunk.toString();
        return true;
      }) as NodeJS.WriteStream["write"],
    },
    stderr: { write: () => true },
  });
  return stdout;
}

const refused = (required: string, max = "10 (default)") => ({
  code: "E_LIMIT_EXCEEDED",
  exitCode: 4,
  required,
  network: { name: "mainnet" },
  message: `Payment max spend exceeded: max=${max} required=${required}`,
});

it.each([
  { name: "charge at the default cap", intent: "charge", amount: "10000000", paid: {} },
  {
    name: "charge over the default cap",
    intent: "charge",
    amount: "10000001",
    refused: refused("10.000001"),
  },
  {
    name: "charge under --max-spend above the default",
    intent: "charge",
    amount: "25000000",
    args: ["--max-spend", "25"],
    paid: {},
  },
  {
    name: "charge under TEMPO_MAX_SPEND above the default",
    intent: "charge",
    amount: "25000000",
    env: "25",
    paid: {},
  },
  {
    name: "charge over --max-spend, which overrides TEMPO_MAX_SPEND",
    intent: "charge",
    amount: "2000000",
    args: ["--max-spend", "1"],
    env: "25",
    refused: refused("2", "1"),
  },
  {
    name: "charge over TEMPO_MAX_SPEND below the default",
    intent: "charge",
    amount: "2000000",
    env: "1.5",
    refused: refused("2", "1.5"),
  },
  {
    name: "charge under the saved max-spend above the default",
    intent: "charge",
    amount: "25000000",
    saved: "25",
    paid: {},
  },
  {
    name: "charge over the saved max-spend below the default",
    intent: "charge",
    amount: "2000000",
    saved: "1.5",
    refused: refused("2", "1.5"),
  },
  {
    name: "charge over TEMPO_MAX_SPEND, which overrides the saved max-spend",
    intent: "charge",
    amount: "2000000",
    env: "1",
    saved: "25",
    refused: refused("2", "1"),
  },
  {
    name: "charge over --max-spend, which overrides the saved max-spend",
    intent: "charge",
    amount: "2000000",
    args: ["--max-spend", "1"],
    saved: "25",
    refused: refused("2", "1"),
  },
  {
    name: "subscription over the default cap, which leaves recurring offers to the wallet",
    intent: "subscription",
    amount: "25000000",
    paid: {},
  },
  {
    name: "session per-call amount over the default cap",
    intent: "session",
    amount: "10000001",
    suggestedDeposit: "50000000",
    refused: refused("10.000001"),
  },
  {
    name: "session suggested deposit over the default cap",
    intent: "session",
    amount: "1000",
    suggestedDeposit: "50000000",
    paid: { depositRaw: "10000000" },
  },
  {
    name: "session suggested deposit within the default cap",
    intent: "session",
    amount: "1000",
    suggestedDeposit: "2000000",
    paid: { depositRaw: "2000000" },
  },
  {
    name: "session without a suggested deposit under the default cap",
    intent: "session",
    amount: "1000",
    paid: { depositRaw: "1000" },
  },
  {
    name: "session suggested deposit over --max-spend",
    intent: "session",
    amount: "1000",
    suggestedDeposit: "50000000",
    args: ["--max-spend", "20"],
    paid: { depositRaw: "20000000" },
  },
  {
    name: "session suggested deposit within --max-spend",
    intent: "session",
    amount: "1000",
    suggestedDeposit: "50000000",
    args: ["--max-spend", "100"],
    paid: { depositRaw: "50000000" },
  },
  {
    name: "session without a suggested deposit under --max-spend",
    intent: "session",
    amount: "1000",
    args: ["--max-spend", "5"],
    paid: { depositRaw: "5000000" },
  },
  {
    name: "session suggested deposit over TEMPO_MAX_SPEND",
    intent: "session",
    amount: "1000",
    suggestedDeposit: "50000000",
    env: "30",
    paid: { depositRaw: "30000000" },
  },
  {
    name: "session suggested deposit over the saved max-spend",
    intent: "session",
    amount: "1000",
    suggestedDeposit: "50000000",
    saved: "30",
    paid: { depositRaw: "30000000" },
  },
])(
  "caps a $name",
  async ({ intent, amount, suggestedDeposit, args = [], env = "", saved, paid, refused }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_MAX_SPEND", env);
    if (saved) await saveConfigValue("max-spend", saved);
    const { origin, seen } = await service({ intent, amount, suggestedDeposit });
    const request = run(args, `${origin}/paid`);

    if (refused) {
      await expect(request).rejects.toMatchObject(refused);
      expect(credentialOptions).toEqual([]);
      expect(seen).toEqual([false]);
      return;
    }
    await expect(request).resolves.toBe("paid");
    expect(credentialOptions).toHaveLength(1);
    if (paid.depositRaw) expect(credentialOptions[0]).toEqual({ depositRaw: paid.depositRaw });
    expect(seen).toEqual([false, true]);
  },
);

/** A reusable v2 session for `origin`, paid by the test key. */
function storeSession(origin: string, deposit: bigint, cumulative: bigint) {
  return upsertSessionRecord({
    accepted_cumulative: cumulative,
    authorized_signer: payer,
    chain_id: 4217,
    challenge_echo: "{}",
    channel_id: channelId,
    close_requested_at: 0,
    created_at: 1,
    cumulative_amount: cumulative,
    deposit,
    descriptor_json: JSON.stringify({ payer, payee, token }),
    escrow_contract: TempoChannel.address.toLowerCase(),
    grace_ready_at: 0,
    last_used_at: 1,
    network: "tempo",
    origin,
    payee,
    payer,
    request_url: `${origin}/paid`,
    salt: "0x00",
    server_spent: cumulative,
    session_protocol: "v2",
    state: "active",
    token,
  });
}

const topUpProblem = (requiredTopUp: string) =>
  JSON.stringify({ title: "Insufficient deposit", requiredTopUp });

const topUpRefused = (deposit: string, max: string) => ({
  code: "E_LIMIT_EXCEEDED",
  exitCode: 4,
  message: `Session top-up refused: the deposit would reach ${deposit}, above the spending cap (max=${max}). The voucher for this request was already sent; check the session with 'tempo wallet sessions list --network mainnet' before retrying.`,
});

it.each([
  {
    name: "a voucher reaching the default cap",
    cumulative: 9_000_000n,
    signed: [{ action: "voucher", cumulativeAmountRaw: "10000000" }],
  },
  {
    name: "a voucher past the default cap",
    cumulative: 9_500_000n,
    refused: refused("10.5"),
    signed: [],
  },
  {
    name: "a voucher past the default cap, naming a one-time charge within it",
    cumulative: 9_500_000n,
    charge: "500000",
    refused: { ...refused("10.5"), charge: "0.5" },
    signed: [],
  },
  {
    name: "a voucher past the default cap, with a one-time charge over it",
    cumulative: 9_500_000n,
    charge: "20000000",
    refused: { ...refused("10.5"), charge: undefined },
    signed: [],
  },
  {
    name: "a voucher past the default cap under --payment-intent session",
    cumulative: 9_500_000n,
    charge: "500000",
    args: ["--payment-intent", "session"],
    refused: { ...refused("10.5"), charge: undefined },
    signed: [],
  },
  {
    name: "a voucher past the default cap under --max-spend",
    cumulative: 9_500_000n,
    args: ["--max-spend", "11"],
    signed: [{ action: "voucher", cumulativeAmountRaw: "10500000" }],
  },
  // The voucher is signed before the server asks for more deposit; the top-up never is, and the
  // refusal suggests no rerun, which would pay for the call again.
  {
    name: "a top-up past the default cap",
    deposit: 5_000_000n,
    cumulative: 4_500_000n,
    paidStatus: 402,
    paidBody: topUpProblem("6000000"),
    refused: topUpRefused("11", "10 (default)"),
    signed: [{ action: "voucher", cumulativeAmountRaw: "5500000" }],
  },
  {
    name: "a top-up past the default cap from a stale stored deposit",
    deposit: 1_000_000n,
    onChainDeposit: 5_000_000n,
    cumulative: 900_000n,
    paidStatus: 402,
    paidBody: topUpProblem("6000000"),
    refused: topUpRefused("11", "10 (default)"),
    signed: [{ action: "voucher", cumulativeAmountRaw: "1900000" }],
  },
  {
    name: "a top-up past --max-spend",
    deposit: 5_000_000n,
    cumulative: 4_500_000n,
    args: ["--max-spend", "8"],
    paidStatus: 402,
    paidBody: topUpProblem("4000000"),
    refused: topUpRefused("9", "8"),
    signed: [{ action: "voucher", cumulativeAmountRaw: "5500000" }],
  },
])(
  "caps $name on a reused session",
  async ({
    deposit = 10_000_000n,
    onChainDeposit = deposit,
    cumulative,
    charge,
    args = [],
    paidStatus,
    paidBody,
    refused,
    signed,
  }) => {
    await useTempHome();
    onChain.deposit = onChainDeposit;
    const { origin } = await service({
      intent: "session",
      amount: "1000000",
      charge,
      paidStatus,
      paidBody,
    });
    await storeSession(origin, deposit, cumulative);
    const request = run(args, `${origin}/paid`);

    if (refused) {
      const error = await request.catch((caught: unknown) => caught);
      expect(error).toMatchObject(refused);
      // Only a refusal before the voucher is sent suggests a rerun with a higher cap.
      expect(error instanceof MaxSpendExceededError).toBe(signed.length === 0);
    } else await expect(request).resolves.toBe("paid");
    expect(credentialOptions).toMatchObject(signed);
    expect(credentialOptions).toHaveLength(signed.length);
    if (signed.length === 0)
      expect((await readSessionRecordsByOrigin(origin))[0]?.cumulative_amount).toBe(cumulative);
  },
);

it("suggests raising the cap or a one-time charge for a reused session past it", async () => {
  await useTempHome();
  onChain.deposit = 10_000_000n;
  const { origin, seen } = await service({
    intent: "session",
    amount: "1000000",
    charge: "500000",
  });
  await storeSession(origin, 10_000_000n, 9_500_000n);
  const url = `${origin}/paid`;
  const result = await exec(process.execPath, [cliBundle("request"), "-j", "-X", "POST", url], {
    env: { ...process.env, TEMPO_RPC_URL: `${origin}/rpc` },
  }).catch((error: { stdout: string; stderr: string; code: number }) => error);

  const raise = `tempo request -j --request=POST ${url} --max-spend 10.5 --network mainnet`;
  const charge = `tempo request -j --request=POST ${url} --max-spend 0.5 --payment-intent charge --network mainnet`;
  expect(JSON.parse(result.stderr)).toEqual({
    code: "E_LIMIT_EXCEEDED",
    message: `Payment max spend exceeded: max=10 (default) required=10.5. To allow it, rerun: ${raise}. The server also offers a one-time charge of 0.5, which is not refundable: ${charge}`,
    retryable: false,
    cta: {
      description: "Suggested commands:",
      commands: [
        { command: raise },
        { command: charge, description: "one-time charge, not refundable" },
      ],
    },
  });
  expect(seen).toEqual([false]);
});

const noSqlite3 =
  "sqlite3 was not found on PATH. Payment sessions need it: install sqlite3, then retry.";

it.each([
  {
    intent: "auto",
    args: [],
    failed: {
      message: `Session payment failed: ${noSqlite3}\nA one-time charge of 0.5 is available but was not submitted because charge capacity is non-refundable. Review the amount, then retry with --max-spend 0.5 --payment-intent charge.`,
    },
  },
  {
    intent: "session",
    args: ["--payment-intent", "session"],
    failed: {
      message: noSqlite3,
      payload: { cta: { commands: [{ command: "tempo wallet doctor" }] } },
    },
  },
])(
  "without sqlite3, fails a session offer under --payment-intent $intent before paying",
  async ({ args, failed }) => {
    await useTempHome();
    const { origin, seen } = await service({
      intent: "session",
      amount: "1000000",
      charge: "500000",
    });
    vi.stubEnv("PATH", "/nonexistent-tempo-test-bin");

    await expect(run(args, `${origin}/paid`)).rejects.toMatchObject({
      code: "E_PAYMENT",
      exitCode: 4,
      ...failed,
    });
    expect(seen).toEqual([false]);
    expect(credentialOptions).toEqual([]);
  },
);
