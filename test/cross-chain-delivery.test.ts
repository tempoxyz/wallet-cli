import { Payment } from "machine-fetch";
import { type CrossChain, CrossChainFunder } from "machine-fetch/cross-chain";
import { FileStore } from "machine-fetch/stores/file";
import { MemoryStore } from "machine-fetch/stores/memory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { operationsDirectory } from "../src/payment/attempts.js";
import { deliveryReaders, fundingAccounts, operationStatus } from "../src/request/cross-chain.js";
import type { Destination } from "../src/shared/chains.js";
import { useTempHome } from "./helpers.js";

const chains = vi.hoisted(() => ({
  balances: [] as (bigint | Error)[],
  deliveries: new Map<string, bigint | Error>(),
  reads: [] as string[],
}));

vi.mock("../src/shared/chains.js", async (original) => ({
  ...(await original<typeof import("../src/shared/chains.js")>()),
  async destinationBalance(_destination: unknown, owner: string) {
    chains.reads.push(`balance ${owner}`);
    const next = chains.balances.length > 1 ? chains.balances.shift()! : chains.balances[0]!;
    if (next instanceof Error) throw next;
    return next;
  },
  async destinationDelivery(_destination: unknown, hash: string, owner: string) {
    chains.reads.push(`delivery ${hash} ${owner}`);
    const delivered = chains.deliveries.get(hash) ?? new Error("receipt not found");
    if (delivered instanceof Error) throw delivered;
    return delivered;
  },
}));

const payer = "0x00000000000000000000000000000000000000b2";
const source = "0x00000000000000000000000000000000000000a1";
const asset = "0x20c0000000000000000000000000000000000000";
const fill = `0x${"de".repeat(32)}`;
const destination: Destination = {
  chainId: 8453,
  name: "base",
  network: "eip155:8453",
  usdc: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    name: "USD Coin",
    version: "2",
  },
  rpcUrl: "http://127.0.0.1:1",
};
const accounts = fundingAccounts(4217, source, asset, destination, payer);

beforeEach(() => {
  chains.balances = [];
  chains.deliveries.clear();
  chains.reads = [];
});

/** A route that quotes exactly, submits, and then reports `statuses` in turn, the last one after. */
function route(...statuses: CrossChain.Status[]): CrossChain.Route & { polls: () => number } {
  let polls = 0;
  return {
    name: "relay",
    quote: (request: CrossChain.Request) => ({
      amountIn: request.amountOut,
      maxAmountIn: request.amountOut,
      amountOut: request.amountOut,
      minAmountOut: request.amountOut,
      expiresAt: request.deadline,
      reference: `relay:${request.operationId}`,
      fees: [],
    }),
    submit: () => ({ reference: `0x${"12".repeat(32)}` }),
    status: () => statuses[Math.min(polls++, statuses.length - 1)]!,
    polls: () => polls,
  };
}

describe("payment funding confirms a delivery on the destination chain", () => {
  /** Funds a 10_000 payment through `bridge` with the CLI's readers, as `crossChainFunders` does. */
  async function pay(bridge: CrossChain.Route, deadlineSeconds?: number) {
    const funder = CrossChainFunder.create({
      ...accounts,
      routes: [bridge],
      operations: MemoryStore.create(),
      ...deliveryReaders(destination),
      pollIntervalMs: 10,
    });
    const plan = await Payment.plan(
      {
        protocol: "x402",
        method: "exact",
        intent: "charge",
        network: destination.network,
        asset: destination.usdc.address,
        amount: 10_000n,
      },
      { funders: [funder], ...(deadlineSeconds ? { deadlineSeconds } : {}) },
    );
    return Payment.fund(plan, { operationId: "attempt-1", payer });
  }

  it("waits for the balance when the bridge reports success before the RPC shows it", async () => {
    // Before funding, then while Base's load-balanced RPC lags behind the provider.
    chains.balances = [0n, 0n, 9_999n, 10_000n];

    const prepared = await pay(route({ status: "completed" }));

    expect(prepared?.funding).toMatchObject({ status: "acquired" });
    expect(chains.reads).toEqual(Array(4).fill(`balance ${payer}`));
  });

  it("retries a balance read a lagging node rejects", async () => {
    chains.balances = [0n, new Error("header not found"), 10_000n];

    const prepared = await pay(route({ status: "completed" }));

    expect(prepared?.funding).toMatchObject({ status: "acquired" });
  });

  it("does not pay from a destination transaction alone: the balance must cover the payment", async () => {
    chains.balances = [0n];
    chains.deliveries.set(fill, 10_000n);

    await expect(pay(route({ status: "completed", destinationTxs: [fill] }), 1)).rejects.toThrow(
      /delivered, but the destination balance did not cover the payment/,
    );
  });
});

describe("reconciliation confirms a completed operation on the destination chain", () => {
  /** Saves an operation for 6_000 out, as a payment's funding would have, and reads its status. */
  async function reconcile(bridge: CrossChain.Route) {
    await useTempHome();
    const request = {
      amountOut: 6_000n,
      deadline: Math.floor(Date.now() / 1000) + 300,
      ...accounts,
      maxSlippageBps: 50,
      operationId: "attempt-1",
    };
    const operation: CrossChain.Operation = {
      id: "attempt-1",
      route: bridge.name,
      requirementKey: "key",
      request,
      quote: await bridge.quote({ ...request, signal: new AbortController().signal }),
      reference: `0x${"12".repeat(32)}`,
    };
    const store = FileStore.create(operationsDirectory());
    await store.claim({ ...operation, reference: undefined });
    await store.setReference(operation.id, operation.reference!);
    return operationStatus({ route: bridge, destination }, operation, 1);
  }

  it("completes once the payer's balance covers the output", async () => {
    chains.balances = [6_000n];

    await expect(reconcile(route({ status: "completed" }))).resolves.toBe("completed");
  });

  it("completes a delivery a payment already spent, from its destination transaction", async () => {
    // A run killed after paying leaves the operation submitted, and the balance back at zero.
    chains.balances = [0n];
    chains.deliveries.set(fill, 6_000n);

    await expect(reconcile(route({ status: "completed", destinationTxs: [fill] }))).resolves.toBe(
      "completed",
    );
    expect(chains.reads).toContain(`delivery ${fill} ${payer}`);
  });

  it.each([
    ["less than the output", 5_999n],
    ["a receipt the RPC does not have yet", new Error("receipt not found")],
  ])("keeps a completion pending when the transaction shows %s", async (_, delivered) => {
    chains.balances = [0n];
    chains.deliveries.set(fill, delivered);

    await expect(reconcile(route({ status: "completed", destinationTxs: [fill] }))).resolves.toBe(
      "pending",
    );
  });

  it.each(["pending", "refunded", "actionRequired"] as const)(
    "passes a %s status through without reading the destination chain",
    async (status) => {
      chains.deliveries.set(fill, 6_000n);

      await expect(reconcile(route({ status, destinationTxs: [fill] }))).resolves.toBe(status);
      expect(chains.reads).toEqual([]);
    },
  );

  it("rejects when the route cannot report", async () => {
    const bridge = route();
    const failing = {
      ...bridge,
      status: () => Promise.reject(new Error("Relay is unreachable")),
    };

    await expect(reconcile(failing)).rejects.toThrow("Relay is unreachable");
  });
});
