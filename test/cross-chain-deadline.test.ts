import { Payment } from "machine-fetch";
import { type CrossChain, CrossChainFunder } from "machine-fetch/cross-chain";
import { MemoryStore } from "machine-fetch/stores/memory";
import { describe, expect, it } from "vitest";

import { fundingAccounts } from "../src/request/cross-chain.js";
import type { Destination } from "../src/shared/chains.js";

const payer = "0x00000000000000000000000000000000000000b2";
const source = "0x00000000000000000000000000000000000000a1";
const asset = "0x20c0000000000000000000000000000000000000";
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

/** The deadline machine-fetch hands a bridge's quote for a payment planned under `policy`. */
async function quotedDeadline(policy: Payment.plan.Options<never>) {
  const deadlines: number[] = [];
  const route = {
    name: "relay",
    quote(request: CrossChain.Request) {
      deadlines.push(request.deadline);
      throw new Error("quote recorded");
    },
    submit: () => ({ reference: "unused" }),
    status: () => ({ status: "pending" as const }),
  } as CrossChain.Route;
  const funder = CrossChainFunder.create({
    ...fundingAccounts(4217, source, asset, destination, payer),
    routes: [route],
    operations: MemoryStore.create(),
    balance: () => 0n,
  });
  const requirement = {
    protocol: "x402",
    method: "exact",
    intent: "charge",
    network: destination.network,
    asset: destination.usdc.address,
    amount: 100_000n,
  };
  const plan = await Payment.plan(requirement, { ...policy, funders: [funder] });
  const now = Math.floor(Date.now() / 1000);
  await Payment.fund(plan, { operationId: "attempt-1", payer }).catch(() => undefined);
  expect(deadlines).toHaveLength(1);
  return deadlines[0]! - now;
}

describe("cross-chain funding deadline", () => {
  it("gives a bridge machine-fetch's 300-second cross-chain default when policy sets none", async () => {
    // LayerZero delivered a Stargate send in 23 s live; Relay's fill plus Base's RPC lag adds up,
    // so the 30-second payment default would time out a delivered bridge.
    const seconds = await quotedDeadline({
      maxPayment: [
        { network: destination.network, asset: destination.usdc.address, amount: 1_000_000n },
      ],
    });
    expect(seconds).toBeGreaterThanOrEqual(299);
    expect(seconds).toBeLessThanOrEqual(301);
  });
});
