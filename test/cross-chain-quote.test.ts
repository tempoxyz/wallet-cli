import { Funder } from "machine-fetch";
import type { CrossChain } from "machine-fetch/cross-chain";
import { describe, expect, it } from "vitest";

import { SourceBalanceError } from "../src/payment/upstream/funding-limit.js";
import { quoteCost, quoteRoutes } from "../src/request/cross-chain-quote.js";

const ousd = "0x20c0000000000000000000006a37DA5C996874BE";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const request: Omit<CrossChain.Request, "signal"> = {
  amountOut: 100_000n,
  deadline: Math.floor(Date.now() / 1000) + 300,
  from: {
    owner: "0x00000000000000000000000000000000000000a1",
    asset: ousd,
    chainId: 4217,
    currency: "USD",
    decimals: 6,
    network: "eip155:4217",
  },
  maxSlippageBps: 50,
  operationId: "dry-run",
  to: {
    owner: "0x00000000000000000000000000000000000000b2",
    asset: usdc,
    chainId: 8453,
    currency: "USD",
    decimals: 6,
    network: "eip155:8453",
  },
};

const fee = (kind: "provider" | "gas", amount: bigint, includedInAmountIn: boolean) => ({
  kind,
  network: "eip155:4217",
  asset: ousd,
  amount,
  includedInAmountIn,
});

/** A bounded quote of `amountIn` with the routes' 0.02 gas fee charged on top. */
function quote(amountIn: bigint, fees = [fee("gas", 20_000n, false)]): CrossChain.BoundedQuote {
  return {
    amountIn,
    maxAmountIn: amountIn,
    amountOut: request.amountOut,
    minAmountOut: request.amountOut,
    expiresAt: request.deadline,
    reference: "quote",
    fees,
  };
}

function route(name: string, answer: CrossChain.Quote | Error): CrossChain.Route {
  return {
    name,
    async quote() {
      if (answer instanceof Error) throw answer;
      return answer;
    },
    submit() {
      throw new Error("a dry run never submits");
    },
    status() {
      throw new Error("a dry run never reads status");
    },
  };
}

describe("quoteCost", () => {
  it("counts a Relay deposit's fee in its input and its gas on top", () => {
    expect(quoteCost(quote(101_300n), request)).toEqual({
      amountIn: 101_300n,
      fee: 1_300n,
      gas: 20_000n,
      total: 121_300n,
    });
  });

  it("counts a Stargate messaging fee already in the input once", () => {
    const stargate = quote(100_550n, [fee("provider", 500n, true), fee("gas", 20_000n, false)]);
    expect(quoteCost(stargate, request)).toEqual({
      amountIn: 100_550n,
      fee: 550n,
      gas: 20_000n,
      total: 120_550n,
    });
  });

  it("adds a provider fee charged beyond the input to the fee and the total", () => {
    const charged = quote(100_000n, [fee("provider", 700n, false), fee("gas", 20_000n, false)]);
    expect(quoteCost(charged, request)).toMatchObject({ fee: 700n, total: 120_700n });
  });
});

describe("quoteRoutes", () => {
  it("chooses the cheapest quote within the funding cap", async () => {
    const { chosen, answers } = await quoteRoutes(
      [route("relay", quote(101_300n)), route("stargate", quote(100_550n))],
      request,
      1_000_000n,
      "OUSD",
    );
    expect(chosen).toMatchObject({ route: "stargate", withinLimit: true });
    expect(answers.map((answer) => answer.route)).toEqual(["relay", "stargate"]);
  });

  it("keeps the first configured route on a tie", async () => {
    const { chosen } = await quoteRoutes(
      [route("relay", quote(101_000n)), route("stargate", quote(101_000n))],
      request,
      1_000_000n,
      "OUSD",
    );
    expect(chosen?.route).toBe("relay");
  });

  it("passes over a cheaper quote the cap refuses for one it allows", async () => {
    // Stargate's input is lower but its fee charged on top lifts its total over the cap.
    const over = quote(100_100n, [fee("provider", 5_000n, false), fee("gas", 20_000n, false)]);
    const { chosen } = await quoteRoutes(
      [route("relay", quote(101_300n)), route("stargate", over)],
      request,
      121_300n,
      "OUSD",
    );
    expect(chosen).toMatchObject({ route: "relay", withinLimit: true });
  });

  it("reports the cheapest quote when the cap refuses every one", async () => {
    const { chosen } = await quoteRoutes(
      [route("relay", quote(101_300n)), route("stargate", quote(100_550n))],
      request,
      100_000n,
      "OUSD",
    );
    expect(chosen).toMatchObject({
      route: "stargate",
      withinLimit: false,
      cost: { total: 120_550n },
    });
  });

  it("names why each route declined", async () => {
    const { chosen, answers } = await quoteRoutes(
      [
        route("relay", new SourceBalanceError(101_300n, 50_000n, ousd)),
        route(
          "stargate",
          new Funder.FundingError("Stargate route declined: \u001b[31mno\u001b[0m"),
        ),
      ],
      request,
      1_000_000n,
      "OUSD",
    );
    expect(chosen).toBeUndefined();
    expect(answers).toEqual([
      {
        route: "relay",
        reason: "needs 0.1013 OUSD, the bridge's fee included, and the wallet holds 0.05",
      },
      { route: "stargate", reason: "Stargate route declined: no" },
    ]);
  });

  it("quotes each route once, for the exact shortfall, with a deadline-bound signal", async () => {
    const relay = route("relay", quote(101_300n));
    const seen: CrossChain.Request[] = [];
    const spy: CrossChain.Route = {
      ...relay,
      async quote(input) {
        seen.push(input);
        return relay.quote(input);
      },
    };
    await quoteRoutes([spy], request, 1_000_000n, "OUSD");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ amountOut: 100_000n, operationId: "dry-run" });
    expect(seen[0]!.signal).toBeInstanceOf(AbortSignal);
  });
});
