import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  hashStruct,
  type Hex,
  parseAbi,
  parseAbiItem,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { evmClient, type Localnet, tempoBalance, tempoClient } from "./localnet.js";

// Adapted from machine-fetch test/e2e/relay.ts (its inventory relay), behind Relay's HTTP API so
// the CLI's Relay route runs for real: it takes the source token on the Tempo chain, through a
// contract deposit into the local depository (as Relay quotes Tempo) or at a single-use deposit
// address, and releases USDC from inventory on the EVM chain.

const depositoryAbi = parseAbi([
  "function depositErc20(address depositor, address token, uint256 amount, bytes32 id)",
]);
const depositEvent = parseAbiItem(
  "event RelayErc20Deposit(address token, uint256 amount, address depositor, bytes32 id)",
);

/** The chain names the stand-in's `/chains` registry gives the local chains. */
const tempoName = "tempo-local";
const evmName = "local-evm";

/** Relay's EIP-712 order types for EVM chains: an order's struct hash is its order ID. */
const orderTypes = {
  Order: [
    { name: "version", type: "string" },
    { name: "solverChainId", type: "string" },
    { name: "solver", type: "address" },
    { name: "salt", type: "uint256" },
    { name: "inputs", type: "Input[]" },
    { name: "output", type: "Output" },
    { name: "fees", type: "Fee[]" },
  ],
  Input: [
    { name: "payment", type: "InputPayment" },
    { name: "refunds", type: "InputRefund[]" },
  ],
  InputPayment: [
    { name: "chainId", type: "string" },
    { name: "currency", type: "bytes" },
    { name: "amount", type: "uint256" },
    { name: "weight", type: "uint256" },
  ],
  InputRefund: [
    { name: "chainId", type: "string" },
    { name: "recipient", type: "bytes" },
    { name: "currency", type: "bytes" },
    { name: "minimumAmount", type: "uint256" },
    { name: "deadline", type: "uint32" },
    { name: "extraData", type: "bytes" },
  ],
  Output: [
    { name: "chainId", type: "string" },
    { name: "payments", type: "OutputPayment[]" },
    { name: "deadline", type: "uint32" },
    { name: "calls", type: "bytes[]" },
    { name: "extraData", type: "bytes" },
  ],
  OutputPayment: [
    { name: "recipient", type: "bytes" },
    { name: "currency", type: "bytes" },
    { name: "minimumAmount", type: "uint256" },
    { name: "expectedAmount", type: "uint256" },
  ],
  Fee: [
    { name: "recipientChainId", type: "string" },
    { name: "recipient", type: "bytes" },
    { name: "currencyChainId", type: "string" },
    { name: "currency", type: "bytes" },
    { name: "amount", type: "uint256" },
  ],
} as const;

/** Quote tampering that a safe client must refuse before it signs anything. */
export type HostileQuote =
  | "wrong-destination-recipient"
  | "wrong-chain"
  | "extra-step"
  | "arbitrary-contract"
  | "amount-above-bound"
  | "expired"
  | "non-canonical-amount"
  | "wrong-spender"
  | "wrong-order";

type Intent = {
  requestId: Hex;
  /** The contract deposit's order ID, or none for a deposit-address quote. */
  orderId?: Hex;
  depositAddress: Address;
  originToken: Address;
  amountIn: bigint;
  recipient: Address;
  destinationToken: Address;
  amountOut: bigint;
  status: "waiting" | "pending" | "success" | "refund";
  /** The destination transfer that filled it. */
  fill?: Hex;
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
  let deliveryLag = 0;
  const deposited: Hex[] = [];
  const depositWaiters: (() => void)[] = [];
  const inventory = evmClient(net);

  const quote = (body: Record<string, unknown>) => {
    const amountOut = BigInt(String(body.amount));
    const amountIn = amountOut + (amountOut * feeBps) / 10_000n + flatFee;
    const requestId = `0x${randomBytes(32).toString("hex")}` as Hex;
    const contract = body.useDepositAddress !== true;
    // The order's own deadline binds the solver, so an expired quote is an expired order.
    const deadline = Math.floor(Date.now() / 1000) + (hostile === "expired" ? -10 : 600);
    const user0 = getAddress(String(body.user));
    const order = {
      version: "v1",
      solverChainId: evmName,
      solver: inventory.account!.address,
      salt: BigInt(`0x${randomBytes(16).toString("hex")}`).toString(),
      inputs: [
        {
          payment: {
            chainId: tempoName,
            currency: getAddress(String(body.originCurrency)),
            amount: amountIn.toString(),
            weight: "1",
          },
          refunds: [
            {
              chainId: tempoName,
              recipient: user0,
              currency: getAddress(String(body.originCurrency)),
              minimumAmount: "0",
              deadline,
              extraData: "0x",
            },
          ],
        },
      ],
      output: {
        chainId: evmName,
        payments: [
          {
            recipient:
              hostile === "wrong-destination-recipient"
                ? privateKeyToAccount(`0x${"11".repeat(32)}`).address
                : getAddress(String(body.recipient)),
            currency: getAddress(String(body.destinationCurrency)),
            minimumAmount: amountOut.toString(),
            expectedAmount: amountOut.toString(),
          },
        ],
        deadline,
        calls: [] as Hex[],
        extraData: "0x",
      },
      fees: [] as never[],
    };
    const orderId = contract
      ? hashStruct({ types: orderTypes, primaryType: "Order", data: order as never })
      : undefined;
    const depositAddress = contract
      ? net.depository
      : privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`).address;
    const originToken = getAddress(String(body.originCurrency));
    const recipient = getAddress(String(body.recipient));
    const user = String(body.user);
    intents.set(requestId, {
      requestId,
      ...(orderId ? { orderId } : {}),
      depositAddress,
      originToken,
      amountIn,
      recipient,
      destinationToken: getAddress(String(body.destinationCurrency)),
      amountOut,
      status: "waiting",
    });
    const tx = (to: string, data: Hex) => ({
      chainId: Number(body.originChainId),
      from: user,
      to,
      value: "0",
      data: data as string,
    });
    const approve = (spender: Address, amount: bigint) =>
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
    const depositCall = (amount: bigint, id: Hex) =>
      encodeFunctionData({
        abi: depositoryAbi,
        functionName: "depositErc20",
        args: [user as Address, originToken, amount, id],
      });
    const approveTx = tx(originToken, approve(net.depository, amountIn));
    const depositTx = contract
      ? tx(net.depository, depositCall(amountIn, orderId!))
      : tx(
          originToken,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [depositAddress, amountIn],
          }),
        );
    const details = {
      operation: "bridge",
      sender: user,
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
    const steps: Record<string, unknown>[] = contract
      ? [
          {
            id: "approve",
            kind: "transaction",
            requestId,
            items: [{ status: "incomplete", data: approveTx }],
          },
          {
            id: "deposit",
            kind: "transaction",
            requestId,
            items: [{ status: "incomplete", data: depositTx }],
          },
        ]
      : [
          {
            id: "deposit",
            kind: "transaction",
            requestId,
            depositAddress,
            items: [{ status: "incomplete", data: depositTx }],
          },
        ];
    let expiresAt = Math.floor(Date.now() / 1000) + quoteTtlSeconds;
    const stranger = privateKeyToAccount(`0x${"22".repeat(32)}`).address;
    switch (hostile) {
      case "wrong-destination-recipient":
        details.recipient = privateKeyToAccount(`0x${"11".repeat(32)}`).address;
        break;
      case "wrong-chain":
        depositTx.chainId = 4217;
        break;
      case "extra-step":
        steps.push({
          id: "extra",
          kind: "transaction",
          requestId,
          items: [{ status: "incomplete", data: { ...depositTx } }],
        });
        break;
      case "arbitrary-contract":
        depositTx.to = "0x000000000000000000000000000000000000dEaD";
        break;
      case "amount-above-bound":
        approveTx.data = approve(net.depository, amountIn * 2n);
        depositTx.data = contract
          ? depositCall(amountIn * 2n, orderId!)
          : encodeFunctionData({
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
      case "wrong-spender":
        approveTx.data = approve(stranger, amountIn);
        break;
      case "wrong-order":
        depositTx.data = depositCall(amountIn, `0x${"33".repeat(32)}`);
        break;
    }
    return {
      details,
      steps,
      expiresAt,
      fees: {},
      ...(orderId
        ? {
            protocol: {
              v2: {
                orderId,
                orderData: order,
                paymentDetails: { chainId: tempoName, depository: net.depository },
              },
            },
          }
        : {}),
    };
  };

  const tempo = tempoClient(net);
  /** Whether the depository has received `intent`'s deposit, for its order and in full. */
  const depositedByContract = async (intent: Intent) => {
    const logs = await tempo.getLogs({
      address: net.depository,
      event: depositEvent,
      fromBlock: 0n,
    });
    return logs.some(
      (log) =>
        log.args.id?.toLowerCase() === intent.orderId?.toLowerCase() &&
        log.args.token?.toLowerCase() === intent.originToken.toLowerCase() &&
        (log.args.amount ?? 0n) >= intent.amountIn,
    );
  };
  const settle = async (intent: Intent) => {
    if (intent.status !== "waiting") return;
    const arrived = intent.orderId
      ? await depositedByContract(intent)
      : (await tempoBalance(net, intent.originToken, intent.depositAddress)) >= intent.amountIn;
    if (!arrived) return;
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
    // Relay can report success before the destination chain's RPC shows the transfer.
    if (deliveryLag > 0) {
      intent.status = "success";
      await new Promise((resolve) => setTimeout(resolve, deliveryLag));
    }
    const hash = await inventory.writeContract({
      address: net.evmUsdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [intent.recipient, intent.amountOut],
    });
    intent.fill = hash;
    const receipt = await inventory.waitForTransactionReceipt({ hash });
    if (deliveryLag === 0) intent.status = receipt.status === "success" ? "success" : "refund";
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
      if (request.method === "GET" && url.pathname === "/chains")
        return json(200, {
          chains: [
            {
              id: net.tempoChainId,
              protocol: { v2: { chainId: tempoName, depository: net.depository } },
            },
            {
              id: net.evmChainId,
              protocol: { v2: { chainId: evmName, depository: net.depository } },
            },
          ],
        });
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
          ...(intent.status === "success"
            ? { inTxHashes: [], txHashes: intent.fill ? [intent.fill] : [] }
            : {}),
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
    /** Reports each release as a success `ms` before the destination transfer lands. */
    lagDelivery(ms: number) {
      deliveryLag = ms;
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
