import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { type Address, erc20Abi, getAddress, type Hex, parseAbiItem } from "viem";

import { evmClient, type Localnet, tempoClient } from "./localnet.js";

// The off-chain half of the local Stargate: it watches the local OFT's sends on the Tempo chain,
// releases the received USDC from inventory on the EVM chain, and answers LayerZero Scan's
// message API, so the CLI's Stargate route runs for real.

const sentEvent = parseAbiItem(
  "event Sent(uint32 dstEid, bytes32 to, uint256 amountLD, uint256 amountReceivedLD)",
);

type Message = { recipient: Address; amount: bigint; status: "INFLIGHT" | "DELIVERED" | "FAILED" };

export type StandInStargate = Awaited<ReturnType<typeof standInStargate>>;

export async function standInStargate(net: Localnet) {
  const messages = new Map<Hex, Message>();
  const sent: Hex[] = [];
  const sentWaiters: (() => void)[] = [];
  let holdDelivery = false;
  const tempo = tempoClient(net);
  const inventory = evmClient(net);
  // Earlier tests share the chain: only sends from this stand-in's lifetime are its own.
  const fromBlock = (await tempo.getBlockNumber()) + 1n;

  const watch = async () => {
    const logs = await tempo.getLogs({ address: net.stargate, event: sentEvent, fromBlock });
    for (const log of logs) {
      const hash = log.transactionHash as Hex;
      if (messages.has(hash)) continue;
      messages.set(hash, {
        recipient: getAddress(`0x${(log.args.to as Hex).slice(26)}`),
        amount: log.args.amountReceivedLD ?? 0n,
        status: "INFLIGHT",
      });
      sent.push(hash);
      for (const wake of sentWaiters.splice(0)) wake();
    }
  };
  const deliver = async (message: Message) => {
    if (message.status !== "INFLIGHT" || holdDelivery) return;
    const hash = await inventory.writeContract({
      address: net.evmUsdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [message.recipient, message.amount],
    });
    const receipt = await inventory.waitForTransactionReceipt({ hash });
    message.status = receipt.status === "success" ? "DELIVERED" : "FAILED";
  };
  let polling = true;
  const poll = (async () => {
    while (polling) {
      await watch().catch(() => undefined);
      for (const message of messages.values()) await deliver(message).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();

  const server = createServer((request, response) => {
    const json = (status: number, body: unknown) =>
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const match = /^\/v1\/messages\/tx\/(0x[0-9a-fA-F]{64})$/.exec(
      new URL(request.url ?? "/", "http://scan").pathname,
    );
    if (request.method !== "GET" || !match) return json(404, { message: "Not found" });
    const message = messages.get(match[1]!.toLowerCase() as Hex) ?? messages.get(match[1] as Hex);
    if (!message) return json(404, { message: "Unknown message" });
    return json(200, { data: [{ status: { name: message.status } }] });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    /** Source transaction hashes of the sends seen, in order. */
    sent,
    /** Holds sends in flight instead of delivering them, until called with false. */
    hold(value: boolean) {
      holdDelivery = value;
    },
    /** Resolves once `count` sends have been seen. */
    async waitForSends(count: number) {
      while (sent.length < count) await new Promise<void>((wake) => sentWaiters.push(wake));
    },
    async close() {
      polling = false;
      await poll;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
