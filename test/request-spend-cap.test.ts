import { createServer } from "node:http";

import { Challenge, Credential } from "mppx";
import { privateKeyToAccount } from "viem/accounts";
import { Channel as TempoChannel } from "viem/tempo";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { runRequest } from "../src/commands/request.js";
import { readSessionRecordsByOrigin, upsertSessionRecord } from "../src/payment/session-store.js";
import { testPrivateKey, useTempHome } from "./helpers.js";

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

/** A 402 service; a paid request gets `paidStatus` and `paidBody`. */
async function service(options: {
  intent: string;
  amount: string;
  suggestedDeposit?: string | undefined;
  paidStatus?: number | undefined;
  paidBody?: string | undefined;
}) {
  const seen: boolean[] = [];
  const challenge = Challenge.from({
    id: "spend-cap",
    realm: "local",
    method: "tempo",
    intent: options.intent,
    request: {
      amount: options.amount,
      currency: token,
      recipient: payee,
      methodDetails: {
        chainId: 4217,
        ...(options.intent === "session" ? { sessionProtocol: "v2" } : {}),
      },
      ...(options.suggestedDeposit ? { suggestedDeposit: options.suggestedDeposit } : {}),
    },
  });
  const server = createServer((req, res) => {
    seen.push(Boolean(req.headers.authorization));
    if (!req.headers.authorization) {
      res.writeHead(402, { "www-authenticate": Challenge.serialize(challenge) });
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
])(
  "caps a $name",
  async ({ intent, amount, suggestedDeposit, args = [], env = "", paid, refused }) => {
    await useTempHome();
    vi.stubEnv("TEMPO_MAX_SPEND", env);
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
    name: "a voucher past the default cap under --max-spend",
    cumulative: 9_500_000n,
    args: ["--max-spend", "11"],
    signed: [{ action: "voucher", cumulativeAmountRaw: "10500000" }],
  },
  {
    name: "a top-up past the default cap",
    deposit: 5_000_000n,
    cumulative: 4_500_000n,
    paidStatus: 402,
    paidBody: JSON.stringify({ title: "Insufficient deposit", requiredTopUp: "6000000" }),
    refused: refused("11"),
    // The voucher is signed before the server asks for more deposit; the top-up never is.
    signed: [{ action: "voucher", cumulativeAmountRaw: "5500000" }],
  },
])(
  "caps $name on a reused session",
  async ({
    deposit = 10_000_000n,
    cumulative,
    args = [],
    paidStatus,
    paidBody,
    refused,
    signed,
  }) => {
    await useTempHome();
    onChain.deposit = deposit;
    const { origin } = await service({
      intent: "session",
      amount: "1000000",
      paidStatus,
      paidBody,
    });
    await upsertSessionRecord({
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
    const request = run(args, `${origin}/paid`);

    if (refused) await expect(request).rejects.toMatchObject(refused);
    else await expect(request).resolves.toBe("paid");
    expect(credentialOptions).toMatchObject(signed);
    expect(credentialOptions).toHaveLength(signed.length);
    if (signed.length === 0)
      expect((await readSessionRecordsByOrigin(origin))[0]?.cumulative_amount).toBe(cumulative);
  },
);
