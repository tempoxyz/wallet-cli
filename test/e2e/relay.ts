import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { type Address, encodeFunctionData, erc20Abi, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { evmClient, type Localnet, tempoBalance } from "./localnet.js";

// Adapted from machine-fetch test/e2e/relay.ts (its inventory relay), behind Relay's HTTP API so
// the CLI's Relay route runs for real: it takes OUSD on the Tempo chain at a single-use deposit
// address and releases USDC from inventory on the EVM chain.

/** Quote tampering that a safe client must refuse before it signs anything. */
export type HostileQuote =
  | "wrong-destination-recipient"
  | "wrong-chain"
  | "extra-step"
  | "arbitrary-contract"
  | "amount-above-bound"
  | "expired"
  | "non-canonical-amount"
  | "wrong-deposit-recipient";

type Intent = {
  requestId: Hex;
  depositAddress: Address;
  originToken: Address;
  amountIn: bigint;
  recipient: Address;
  destinationToken: Address;
  amountOut: bigint;
  status: "waiting" | "pending" | "success" | "refund";
};

/** Relay's fee on the stand-in: 0.3% of the output plus 0.001 of the origin token. */
const feeBps = 30n;
const flatFee = 1_000n;
const quoteTtlSeconds = 60;

export type StandInRelay = Awaited<ReturnType<typeof standInRelay>>;

export async function standInRelay(net: Localnet) {
  const intents = new Map<Hex, Intent>();
  const quotes: Record<string, unknown>[] = [];
  let hostile: HostileQuote | undefined;
  let holdRelease = false;
  let refund = false;
  const deposited: Hex[] = [];
  const depositWaiters: (() => void)[] = [];
  const inventory = evmClient(net);

  const quote = (body: Record<string, unknown>) => {
    const amountOut = BigInt(String(body.amount));
    const amountIn = amountOut + (amountOut * feeBps) / 10_000n + flatFee;
    const requestId = `0x${randomBytes(32).toString("hex")}` as Hex;
    const depositAddress = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`).address;
    const originToken = getAddress(String(body.originCurrency));
    const recipient = getAddress(String(body.recipient));
    intents.set(requestId, {
      requestId,
      depositAddress,
      originToken,
      amountIn,
      recipient,
      destinationToken: getAddress(String(body.destinationCurrency)),
      amountOut,
      status: "waiting",
    });
    const deposit = {
      chainId: Number(body.originChainId),
      from: String(body.user),
      to: originToken as string,
      value: "0",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [depositAddress, amountIn],
      }) as string,
    };
    const details = {
      operation: "bridge",
      sender: String(body.user),
      recipient: recipient as string,
      currencyIn: {
        amount: amountIn.toString(),
        currency: { chainId: Number(body.originChainId), address: originToken as string },
      },
      currencyOut: {
        amount: amountOut.toString(),
        currency: {
          chainId: Number(body.destinationChainId),
          address: String(body.destinationCurrency),
        },
      },
    };
    const steps: Record<string, unknown>[] = [
      {
        id: "deposit",
        kind: "transaction",
        requestId,
        depositAddress,
        items: [{ status: "incomplete", data: deposit }],
      },
    ];
    let expiresAt = Math.floor(Date.now() / 1000) + quoteTtlSeconds;
    switch (hostile) {
      case "wrong-destination-recipient":
        details.recipient = privateKeyToAccount(`0x${"11".repeat(32)}`).address;
        break;
      case "wrong-chain":
        deposit.chainId = 4217;
        break;
      case "extra-step":
        steps.push({
          id: "approve",
          kind: "transaction",
          requestId,
          items: [{ status: "incomplete", data: { ...deposit } }],
        });
        break;
      case "arbitrary-contract":
        deposit.to = "0x000000000000000000000000000000000000dEaD";
        break;
      case "amount-above-bound":
        deposit.data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [depositAddress, amountIn * 2n],
        });
        break;
      case "expired":
        expiresAt = Math.floor(Date.now() / 1000) - 10;
        break;
      case "non-canonical-amount":
        details.currencyIn.amount = `0${amountIn}`;
        break;
      case "wrong-deposit-recipient":
        deposit.data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [privateKeyToAccount(`0x${"22".repeat(32)}`).address, amountIn],
        });
        break;
    }
    return { details, steps, expiresAt, fees: {} };
  };

  const settle = async (intent: Intent) => {
    if (intent.status !== "waiting") return;
    if ((await tempoBalance(net, intent.originToken, intent.depositAddress)) < intent.amountIn)
      return;
    intent.status = "pending";
    deposited.push(intent.requestId);
    for (const wake of depositWaiters.splice(0)) wake();
  };
  const release = async (intent: Intent) => {
    if (intent.status !== "pending" || holdRelease) return;
    if (refund) {
      intent.status = "refund";
      return;
    }
    const hash = await inventory.writeContract({
      address: net.evmUsdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [intent.recipient, intent.amountOut],
    });
    const receipt = await inventory.waitForTransactionReceipt({ hash });
    intent.status = receipt.status === "success" ? "success" : "refund";
  };
  let polling = true;
  const poll = (async () => {
    while (polling) {
      for (const intent of intents.values()) {
        await settle(intent).catch(() => undefined);
        await release(intent).catch(() => undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://relay");
    const json = (status: number, body: unknown) =>
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    try {
      if (request.method === "POST" && url.pathname === "/quote/v2") {
        const body = JSON.parse(await read(request)) as Record<string, unknown>;
        quotes.push(body);
        return json(200, quote(body));
      }
      if (request.method === "GET" && url.pathname === "/intents/status/v3") {
        const intent = intents.get(url.searchParams.get("requestId") as Hex);
        if (!intent) return json(404, { message: "Unknown request" });
        return json(200, {
          status: intent.status,
          ...(intent.status === "success" ? { inTxHashes: [], txHashes: [] } : {}),
        });
      }
      return json(404, { message: "Not found" });
    } catch (error) {
      return json(400, { message: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    /** Quote request bodies, in order. */
    quotes,
    /** Request IDs whose deposit arrived, in order. */
    deposited,
    /** Tampers with every later quote. */
    hostile(mode: HostileQuote | undefined) {
      hostile = mode;
    },
    /** Holds deposits pending instead of releasing them, until called with false. */
    hold(value: boolean) {
      holdRelease = value;
    },
    /** Refunds deposits instead of releasing them. */
    refund(value: boolean) {
      refund = value;
    },
    /** Resolves once `count` deposits have arrived. */
    async waitForDeposits(count: number) {
      while (deposited.length < count) await new Promise<void>((wake) => depositWaiters.push(wake));
    },
    intent: (requestId: Hex) => intents.get(requestId),
    async close() {
      polling = false;
      await poll;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
