import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { evm, Mppx, NodeListener, Request as ServerRequest, tempo } from "mppx/server";
import { type Address, getAddress, type Hex, parseAbi, parseSignature } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { evmClient, type Localnet, tempoClient } from "./localnet.js";

// Adapted from machine-fetch test/e2e/servers.

const authorizationAbi = parseAbi([
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)",
]);

/** Reports a server-side payment failure on stderr, where vitest shows it with the failing test. */
function logged<args extends unknown[], result>(action: (...args: args) => Promise<result>) {
  return async (...args: args) => {
    try {
      return await action(...args);
    } catch (error) {
      console.error("local server payment failure:", error);
      throw error;
    }
  };
}

export type LocalServer = { origin: string; close(): Promise<void> };

/** Serves `app` on a random loopback port. */
export async function serve(app: (request: Request) => Promise<Response>): Promise<LocalServer> {
  const server = createServer(async (request, response) => {
    try {
      await NodeListener.sendResponse(
        response,
        await app(ServerRequest.fromNodeListener(request, response)),
      );
    } catch (error) {
      response
        .writeHead(500)
        .end(
          `Payment verification or settlement failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** An MPP Tempo charge endpoint, `/paid`, priced at `amount` of `currency` on the local chain. */
export function mppServer(
  net: Localnet,
  options: { currency: Address; recipient: Address; amount?: string },
) {
  const client = tempoClient(net);
  const methods = tempo.charge({
    currency: options.currency,
    recipient: options.recipient,
    getClient: () => client,
  });
  const payments = Mppx.create({
    methods: [
      methods.map((method) => ({
        ...method,
        verify: logged(method.verify),
        ...(method.broadcast ? { broadcast: logged(method.broadcast) } : {}),
        ...(method.validate ? { validate: logged(method.validate) } : {}),
      })),
    ],
    secretKey: randomBytes(32).toString("hex"),
  });
  const paid = payments.tempo.charge({
    amount: options.amount ?? "0.01",
    chainId: net.tempoChainId,
  });
  return async (request: Request) => {
    if (new URL(request.url).pathname !== "/paid")
      return new Response("Not found", { status: 404 });
    const result = await paid(request);
    if (result.status === 402) return result.challenge;
    return result.withReceipt(Response.json({ data: "paid on Tempo" }));
  };
}

/**
 * An EVM charge endpoint, `/paid`, priced at `amount` of the local EIP-3009 USDC, settled by the
 * server itself. With `x402Only` it answers with only the x402 v2 `PAYMENT-REQUIRED` header.
 */
export function evmServer(
  net: Localnet,
  options: {
    account: PrivateKeyAccount;
    amount?: string;
    x402Only?: boolean;
    /** Answers this many paid requests with HTTP 500 before settling anything. */
    rejectPaid?: number;
    /** Runs after a payment settles and before the response is sent. */
    afterSettle?: () => Promise<void>;
  },
) {
  let rejections = options.rejectPaid ?? 0;
  const wallet = evmClient(net, options.account);
  const method = evm.charge({
    currency: net.evmUsdc,
    chainId: net.evmChainId,
    decimals: 6,
    authorization: { name: "USDC", version: "2" },
    recipient: options.account.address,
    async settle({ payload }) {
      const signature = parseSignature(payload.signature as Hex);
      const { request } = await wallet.simulateContract({
        address: net.evmUsdc,
        abi: authorizationAbi,
        functionName: "transferWithAuthorization",
        args: [
          getAddress(payload.from),
          getAddress(payload.to),
          BigInt(payload.value),
          BigInt(payload.validAfter),
          BigInt(payload.validBefore),
          payload.nonce as Hex,
          Number(signature.v ?? BigInt(27 + signature.yParity)),
          signature.r,
          signature.s,
        ],
      });
      const hash = await wallet.writeContract(request);
      const receipt = await wallet.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("USDC settlement reverted");
      return { reference: hash };
    },
  });
  const payments = Mppx.create({ methods: [method], secretKey: randomBytes(32).toString("hex") });
  const paid = payments.evm.charge({ amount: options.amount ?? "0.10" });
  return async (request: Request) => {
    if (new URL(request.url).pathname !== "/paid")
      return new Response("Not found", { status: 404 });
    const credential =
      request.headers.has("payment-signature") || request.headers.has("authorization");
    if (credential && rejections > 0) {
      rejections -= 1;
      return new Response("upstream failed", { status: 500 });
    }
    const result = await paid(request);
    if (result.status === 402) {
      if (!options.x402Only) return result.challenge;
      const headers = new Headers(result.challenge.headers);
      headers.delete("www-authenticate");
      return new Response(result.challenge.body, { status: 402, headers });
    }
    await options.afterSettle?.();
    return result.withReceipt(Response.json({ data: "paid on the EVM chain" }));
  };
}
