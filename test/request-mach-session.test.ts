import { createServer } from "node:http";
import { Challenge, Credential } from "mppx";
import { machineTokenDeployments } from "mppx/tempo";
import { decodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prepareTransactionRequest, signTransaction } from "viem/actions";
import { Abis, Actions, Channel, Transaction } from "viem/tempo";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { buildSessionManagementTransactionRequest } from "../src/commands/sessions/close.js";
import { readOnChainChannel } from "../src/payment/channel.js";
import { readSessionRecordsByOrigin } from "../src/payment/session-store.js";
import { parseRequestArgs } from "../src/request/args.js";
import { preparePaymentChallenge } from "../src/request/challenge.js";
import { preferMachSession } from "../src/request/session.js";
import { runRequest } from "../src/request/run.js";
import { usdcToken } from "../src/shared/constants.js";
import { testPrivateKey, useTempHome, walletState, writeWalletState } from "./helpers.js";

vi.mock("viem/actions", async (original) => ({
  ...(await original<typeof import("viem/actions")>()),
  prepareTransactionRequest: vi.fn(),
  signTransaction: vi.fn(),
}));
vi.mock("viem/tempo", async (original) => {
  const actual = await original<typeof import("viem/tempo")>();
  return {
    ...actual,
    Actions: {
      ...actual.Actions,
      token: {
        ...actual.Actions.token,
        getBalance: vi.fn(),
      },
    },
  };
});
vi.mock("../src/payment/channel.js", async (original) => ({
  ...(await original<typeof import("../src/payment/channel.js")>()),
  readOnChainChannel: vi.fn(),
}));

const mach = machineTokenDeployments[4217].token;
const payee = "0x1111111111111111111111111111111111111111";
const account = privateKeyToAccount(testPrivateKey);
const servers: ReturnType<typeof createServer>[] = [];
const silent = { write: () => true };

beforeEach(async () => {
  await useTempHome();
  vi.stubEnv("TEMPO_PRIVATE_KEY", testPrivateKey);
  vi.stubEnv("TEMPO_MAX_SPEND", "");
  vi.stubEnv("TEMPO_WALLET_NETWORK", "mainnet");
  vi.mocked(Actions.token.getBalance).mockResolvedValue({ amount: 1_000_000n } as never);
  vi.mocked(readOnChainChannel).mockResolvedValue(null);
  vi.mocked(prepareTransactionRequest).mockImplementation(
    async (_client, request) =>
      ({
        ...request,
        chainId: 4217,
        type: "tempo",
        nonce: 0,
        nonceKey: 2n ** 256n - 1n,
        validBefore: Math.floor(Date.now() / 1000) + 60,
        gas: 100_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
      }) as never,
  );
  // Exercise real SDK credential construction and real local signing, with no chain broadcast.
  vi.mocked(signTransaction).mockImplementation(
    async (_client, request) =>
      account.signTransaction(request as never, {
        serializer: Transaction.serialize as never,
      }) as never,
  );
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

function offer(currency: string = mach, methodDetails: Record<string, unknown> = {}) {
  return Challenge.from({
    id: `session-${currency}`,
    realm: "local",
    method: "tempo",
    intent: "session",
    request: {
      amount: "1000",
      currency,
      recipient: payee,
      methodDetails: {
        chainId: 4217,
        sessionProtocol: "v2",
        escrowContract: Channel.address,
        feePayer: true,
        feeToken: usdcToken,
        ...methodDetails,
      },
    },
  });
}
function response(offers = [offer(usdcToken), offer()]) {
  return new Response(null, {
    status: 402,
    headers: {
      "www-authenticate": offers.map(Challenge.serialize).join(", "),
    },
  });
}
async function service(offers = [offer(usdcToken), offer()], topUp = false, paidStatus = 200) {
  const paid: ReturnType<typeof Credential.deserialize<Record<string, unknown>>>[] = [];
  const accepts: (string | string[] | undefined)[] = [];
  const server = createServer((req, res) => {
    accepts.push(req.headers["accept-payment"]);
    if (req.headers.authorization) {
      const credential = Credential.deserialize<Record<string, unknown>>(req.headers.authorization);
      paid.push(credential);
      if (topUp && credential.payload.action === "voucher" && paid.length === 2) {
        res.writeHead(402, { "content-type": "application/problem+json" });
        res.end(JSON.stringify({ title: "Insufficient deposit", requiredTopUp: "500" }));
      } else {
        res.statusCode = paidStatus;
        res.end("paid");
      }
    } else {
      res.writeHead(402, { "www-authenticate": response(offers).headers.get("www-authenticate")! });
      res.end("payment required");
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No address");
  return { url: `http://127.0.0.1:${addr.port}`, paid, accepts };
}
function run(url: string, flags: string[] = []) {
  return runRequest([...flags, "--max-spend", "0.003", url], { stdout: silent, stderr: silent });
}

it.each(
  [[], ["--mach"], ["--mach", "--payment-intent", "session"], ["--payment-token", mach]].map(
    (flags) => ({ flags }),
  ),
)("opens a direct MACH session with the real SDK using $flags", async ({ flags }) => {
  const endpoint = await service();
  await run(endpoint.url, flags);
  expect(endpoint.paid).toHaveLength(1);
  const credential = endpoint.paid[0]!;
  expect(credential.challenge).toEqual(offer());
  expect(credential.payload).toMatchObject({
    action: "open",
    descriptor: { token: mach, payee },
  });
  const tx = Transaction.deserialize(credential.payload.transaction as `0x76${string}`);
  expect(vi.mocked(prepareTransactionRequest).mock.calls.at(-1)![1]).toMatchObject({
    feeToken: usdcToken,
    feePayer: true,
  });
  expect(tx.feePayerSignature).toBeNull();
  expect(tx.calls).toHaveLength(1);
  expect(tx.calls[0]!.to?.toLowerCase()).toBe(Channel.address.toLowerCase());
  expect(
    decodeFunctionData({ abi: Abis.tip20ChannelReserve, data: tx.calls[0]!.data! }),
  ).toMatchObject({
    functionName: "open",
    args: [payee, expect.any(String), mach, 3000n, expect.any(String), account.address],
  });
  const stored = await readSessionRecordsByOrigin(endpoint.url);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    token: mach.toLowerCase(),
    payee: payee.toLowerCase(),
    deposit: 3000n,
  });
  expect(endpoint.accepts[0]).toBe(flags.includes("session") ? "tempo/session" : undefined);
});

it.each([false, true])(
  "uses USDC.e when MACH cannot cover the deposit (MACH first: %s)",
  async (first) => {
    vi.mocked(Actions.token.getBalance).mockImplementation(
      async (_client, args) =>
        ({
          amount: String(args.token).toLowerCase() === mach.toLowerCase() ? 1000n : 1_000_000n,
        }) as never,
    );
    const endpoint = await service(first ? [offer(), offer(usdcToken)] : undefined);
    await run(endpoint.url);
    expect(endpoint.paid[0]!.challenge.request.currency).toBe(usdcToken);
  },
);
it("keeps explicit MACH strict when its deposit is unaffordable", async () => {
  vi.mocked(Actions.token.getBalance).mockResolvedValue({ amount: 0n } as never);
  const endpoint = await service();
  await expect(run(endpoint.url, ["--mach"])).rejects.toThrow(
    "Insufficient balance for session deposit",
  );
  expect(endpoint.paid).toEqual([]);
  expect(signTransaction).not.toHaveBeenCalled();
});
it("honors an explicit stablecoin selection", async () => {
  const endpoint = await service([offer(), offer(usdcToken)]);
  await run(endpoint.url, ["--payment-token", usdcToken]);
  expect(endpoint.paid[0]!.challenge.request.currency).toBe(usdcToken);
});
it("uses the other session when the MACH balance cannot be read", async () => {
  vi.mocked(Actions.token.getBalance).mockRejectedValue(new Error("RPC unavailable"));
  const options = parseRequestArgs(["https://example.com"]);
  const selected = await preferMachSession(
    response([offer(), offer(usdcToken)]),
    options,
    options.url,
  );
  expect(preparePaymentChallenge(selected, options, options.url).challenge.request.currency).toBe(
    usdcToken,
  );
  expect(signTransaction).not.toHaveBeenCalled();
});
it("skips MACH when the stored key limit cannot fund its deposit", async () => {
  vi.stubEnv("TEMPO_PRIVATE_KEY", "");
  await writeWalletState(
    walletState({
      accessKeys: [
        {
          ...walletState().accessKeys[0]!,
          permissionSemantics: 1,
          limits: [{ token: usdcToken, limit: "1000000#__bigint" }],
        },
      ],
    }),
  );
  const options = parseRequestArgs(["https://example.com"]);
  const selected = await preferMachSession(response(), options, options.url);
  expect(preparePaymentChallenge(selected, options, options.url).challenge.request.currency).toBe(
    usdcToken,
  );
  expect(Actions.token.getBalance).not.toHaveBeenCalled();
});

it.each([false, true])(
  "reuses MACH channels and handles native top-ups (top-up: %s)",
  async (topUp) => {
    const endpoint = await service(undefined, topUp);
    await run(endpoint.url);
    const record = (await readSessionRecordsByOrigin(endpoint.url))[0]!;
    vi.mocked(readOnChainChannel).mockResolvedValue({
      payer: account.address,
      payee,
      token: mach,
      authorizedSigner: account.address,
      deposit: topUp ? 1500n : 3000n,
      settled: 0n,
      closeRequestedAt: 0n,
    });
    vi.mocked(Actions.token.getBalance).mockResolvedValue({ amount: topUp ? 500n : 0n } as never);
    await run(endpoint.url);
    expect(endpoint.paid.map((paid) => paid.payload.action)).toEqual(
      topUp ? ["open", "voucher", "topUp", "voucher"] : ["open", "voucher"],
    );
    expect(endpoint.paid.every((paid) => paid.challenge.request.currency === mach)).toBe(true);
    const stored = (await readSessionRecordsByOrigin(endpoint.url))[0]!;
    expect(stored.channel_id).toBe(record.channel_id);
    expect(stored.cumulative_amount).toBe(2000n);
    if (topUp) {
      const tx = Transaction.deserialize(endpoint.paid[2]!.payload.transaction as `0x76${string}`);
      expect(vi.mocked(prepareTransactionRequest).mock.calls.at(-1)![1]).toMatchObject({
        feeToken: usdcToken,
        feePayer: true,
      });
      expect(tx.calls).toHaveLength(1);
      expect(
        decodeFunctionData({ abi: Abis.tip20ChannelReserve, data: tx.calls[0]!.data! }),
      ).toMatchObject({
        functionName: "topUp",
        args: [expect.objectContaining({ token: mach }), 500n],
      });
    }
    for (const functionName of ["requestClose", "withdraw"] as const) {
      const tx = buildSessionManagementTransactionRequest({
        channelId: record.channel_id as Hex,
        escrowContract: Channel.address,
        functionName,
        record: { ...record, state: "active" },
      });
      expect(tx.feeToken).toBe(usdcToken);
      expect(tx.calls).toHaveLength(1);
      expect(
        decodeFunctionData({ abi: Abis.tip20ChannelReserve, data: tx.calls[0]!.data }),
      ).toMatchObject({
        functionName,
        args: [expect.objectContaining({ token: mach, payee })],
      });
    }
  },
);

it.each([
  ["missing gas token", { feeToken: undefined }, "advertised fee token"],
  ["MACH gas token", { feeToken: mach }, "MACH cannot pay"],
  ["invalid gas token", { feeToken: "invalid" }, "valid fee token"],
  ["custom escrow", { escrowContract: payee }, "Unsupported Tempo session escrow"],
  ["wrong network", { chainId: 42431 }, "network mismatch"],
  ["old protocol", { sessionProtocol: "v1" }, "did not offer payment token"],
] as const)("rejects a MACH session with %s before signing", (_label, details, message) => {
  const options = parseRequestArgs(["--mach", "--max-spend", "0.003", "https://example.com"]);
  expect(() =>
    preparePaymentChallenge(response([offer(mach, details)]), options, options.url),
  ).toThrow(message);
  expect(signTransaction).not.toHaveBeenCalled();
});

it("does not switch currencies after sending a MACH credential", async () => {
  const endpoint = await service(undefined, false, 500);
  await expect(run(endpoint.url)).rejects.toMatchObject({ code: "E_HTTP" });
  expect(endpoint.paid).toHaveLength(1);
  expect(endpoint.paid[0]!.challenge.request.currency).toBe(mach);
});

it("uses the same MACH preference for a read-only quote", async () => {
  const endpoint = await service();
  let output = "";
  await runRequest(["--dry-run", "--max-spend", "0.003", endpoint.url], {
    stdout: {
      write: (chunk) => {
        output += String(chunk);
        return true;
      },
    },
    stderr: silent,
  });
  expect(JSON.parse(output)).toMatchObject({
    intent: "session",
    token: mach.toLowerCase(),
    symbol: "MACH",
    session: "open",
    deposit: "0.003",
    mach: null,
  });
  expect(endpoint.paid).toEqual([]);
  expect(signTransaction).not.toHaveBeenCalled();
  expect(await readSessionRecordsByOrigin(endpoint.url)).toEqual([]);
});
