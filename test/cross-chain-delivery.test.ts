import type { CrossChain } from "machine-fetch/cross-chain";
import { describe, expect, it } from "vitest";

import { confirmedDelivery } from "../src/request/cross-chain.js";
import { crossChainDeadlineSeconds } from "../src/request/evm-charge.js";

const payer = "0x00000000000000000000000000000000000000b2";
const signal = new AbortController().signal;
const operation = {
  operationId: "attempt-1",
  route: "relay",
  reference: `0x${"12".repeat(32)}`,
  request: { amountOut: 6_000n, to: { owner: payer } },
} as unknown as CrossChain.Operation;

function route(status: CrossChain.Status["status"]): CrossChain.Route {
  return {
    name: "relay",
    quote: async () => {
      throw new Error("unused");
    },
    submit: async () => ({ reference: "unused" }),
    status: async () => ({ status }),
  } as unknown as CrossChain.Route;
}

describe("confirmed cross-chain delivery", () => {
  it("keeps a completed bridge pending until the destination balance shows the delivery", async () => {
    const balances = [0n, 9_999n, 10_000n];
    const owners: string[] = [];
    const confirmed = confirmedDelivery(
      route("completed"),
      async (owner) => (owners.push(owner), balances.shift()!),
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
      confirmedDelivery(route("completed"), async () => held, undefined);

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
      async () => {
        throw new Error("rpc down");
      },
      10_000n,
    );

    await expect(confirmed.status(operation, { signal })).resolves.toEqual({ status: "pending" });
  });

  it.each(["pending", "refunded", "actionRequired"] as const)(
    "passes a %s status through without reading the balance",
    async (status) => {
      let reads = 0;
      const confirmed = confirmedDelivery(route(status), async () => (reads++, 0n), 10_000n);

      await expect(confirmed.status(operation, { signal })).resolves.toEqual({ status });
      expect(reads).toBe(0);
    },
  );

  it("gives cross-chain funding minutes, not machine-fetch's 30-second default", () => {
    // LayerZero delivered a Stargate send in 23 s live; Relay's fill plus Base's RPC lag adds up.
    expect(crossChainDeadlineSeconds).toBeGreaterThanOrEqual(120);
  });
});
