import type { CrossChain } from "machine-fetch/cross-chain";
import { describe, expect, it } from "vitest";

import { confirmedDelivery } from "../src/request/cross-chain.js";

const payer = "0x00000000000000000000000000000000000000b2";
const signal = new AbortController().signal;
const operation = {
  operationId: "attempt-1",
  route: "relay",
  reference: `0x${"12".repeat(32)}`,
  request: { amountOut: 6_000n, to: { owner: payer } },
} as unknown as CrossChain.Operation;

const delivery = `0x${"de".repeat(32)}` as const;
const noDelivery = async () => ({ amount: 0n, block: 0n });
const at = (balance: bigint, block = 1n) => ({ balance, block });

function route(
  status: CrossChain.Status["status"],
  destinationTxs?: readonly `0x${string}`[],
): CrossChain.Route {
  return {
    name: "relay",
    quote: async () => {
      throw new Error("unused");
    },
    submit: async () => ({ reference: "unused" }),
    status: async () => ({ status, ...(destinationTxs ? { destinationTxs } : {}) }),
  } as unknown as CrossChain.Route;
}

describe("confirmed cross-chain delivery", () => {
  it("keeps a completed bridge pending until the destination balance shows the delivery", async () => {
    const balances = [0n, 9_999n, 10_000n];
    const owners: string[] = [];
    const confirmed = confirmedDelivery(
      route("completed"),
      {
        balance: async (owner) => (owners.push(owner), at(balances.shift()!)),
        delivery: noDelivery,
      },
      10_000n,
    );

    const seen = [];
    for (let poll = 0; poll < 3; poll += 1)
      seen.push((await confirmed.status(operation, { signal })).status);

    expect(seen).toEqual(["pending", "pending", "completed"]);
    expect(owners).toEqual([payer, payer, payer]);
  });

  it("defaults the target to the operation's exact output, for reconciliation", async () => {
    const confirmed = (held: bigint) =>
      confirmedDelivery(
        route("completed"),
        { balance: async () => at(held), delivery: noDelivery },
        undefined,
      );

    await expect(confirmed(5_999n).status(operation, { signal })).resolves.toEqual({
      status: "pending",
    });
    await expect(confirmed(6_000n).status(operation, { signal })).resolves.toEqual({
      status: "completed",
    });
  });

  it("treats an unreadable balance as not yet delivered", async () => {
    const confirmed = confirmedDelivery(
      route("completed"),
      {
        balance: async () => {
          throw new Error("rpc down");
        },
        delivery: noDelivery,
      },
      10_000n,
    );

    await expect(confirmed.status(operation, { signal })).resolves.toEqual({ status: "pending" });
  });

  it.each(["pending", "refunded", "actionRequired"] as const)(
    "passes a %s status through without reading the balance",
    async (status) => {
      let reads = 0;
      const confirmed = confirmedDelivery(
        route(status),
        {
          balance: async () => (reads++, at(0n)),
          delivery: async () => (reads++, { amount: 0n, block: 0n }),
        },
        10_000n,
      );

      await expect(confirmed.status(operation, { signal })).resolves.toEqual({ status });
      expect(reads).toBe(0);
    },
  );

  it("completes a delivery a payment already spent, once its destination transaction shows it", async () => {
    // A run killed after paying leaves the operation submitted, and the balance back at zero.
    const reads: [string, string][] = [];
    const confirmed = (delivered: bigint | Error) =>
      confirmedDelivery(
        route("completed", [delivery]),
        {
          balance: async () => at(0n),
          delivery: async (hash, owner) => {
            reads.push([hash, owner]);
            if (delivered instanceof Error) throw delivered;
            return { amount: delivered, block: 7n };
          },
        },
        undefined,
      );

    await expect(confirmed(6_000n).status(operation, { signal })).resolves.toMatchObject({
      status: "completed",
    });
    expect(reads).toEqual([[delivery, payer]]);
    // Less than the output, or a receipt the RPC does not have yet, is not a delivery.
    await expect(confirmed(5_999n).status(operation, { signal })).resolves.toEqual({
      status: "pending",
    });
    await expect(
      confirmed(new Error("receipt not found")).status(operation, { signal }),
    ).resolves.toEqual({ status: "pending" });
  });

  it("does not take a destination transaction without the provider's completion", async () => {
    let reads = 0;
    const confirmed = confirmedDelivery(
      route("pending", [delivery]),
      {
        balance: async () => at(0n),
        delivery: async () => (reads++, { amount: 10_000n, block: 7n }),
      },
      10_000n,
    );

    await expect(confirmed.status(operation, { signal })).resolves.toMatchObject({
      status: "pending",
    });
    expect(reads).toBe(0);
  });

  it("records the block that showed the delivery, so later balance reads start there", async () => {
    const floor: { block?: bigint } = {};
    const byBalance = confirmedDelivery(
      route("completed"),
      { balance: async () => at(10_000n, 41n), delivery: noDelivery, floor },
      10_000n,
    );
    await byBalance.status(operation, { signal });
    expect(floor.block).toBe(41n);

    const byFill = confirmedDelivery(
      route("completed", [delivery]),
      {
        balance: async () => at(0n, 50n),
        delivery: async () => ({ amount: 6_000n, block: 45n }),
        floor,
      },
      undefined,
    );
    await byFill.status(operation, { signal });
    expect(floor.block).toBe(45n);
    // A pending status records nothing.
    const pending = confirmedDelivery(
      route("pending"),
      { balance: async () => at(10_000n, 99n), delivery: noDelivery, floor },
      10_000n,
    );
    await pending.status(operation, { signal });
    expect(floor.block).toBe(45n);
  });
});
