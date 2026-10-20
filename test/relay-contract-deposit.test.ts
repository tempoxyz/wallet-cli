import { Funder } from "machine-fetch";
import type { CrossChain } from "machine-fetch/cross-chain";
import type { RelayProtocolRoute } from "machine-fetch/relay";
import { encodeFunctionData, erc20Abi, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { fundingError } from "../src/payment/funding.js";
import { FundingLimitError, SourceBalanceError } from "../src/payment/upstream/funding-limit.js";
import {
  relayContractDeposit,
  relayDepositoryAbi,
  relayDepositRoute,
} from "../src/payment/upstream/relay-route.js";
import { walletError } from "../src/shared/errors.js";
import { parseNetwork } from "../src/shared/network.js";

const ousd = "0x20c0000000000000000000006a37DA5C996874BE";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const wallet = "0x00000000000000000000000000000000000000a1";
const payer = "0x00000000000000000000000000000000000000b2";
const depository = "0x4cD00E387622C35bDDB9b4c962C136462338BC31";
const other = "0x00000000000000000000000000000000000000d3";
const requestId = `0x${"ab".repeat(32)}`;
const orderId = `0x${"cd".repeat(32)}` as Hex;

const request: CrossChain.Request = {
  amountOut: 100_000n,
  deadline: Math.floor(Date.now() / 1000) + 30,
  from: {
    owner: wallet,
    asset: ousd,
    chainId: 4217,
    currency: "USD",
    decimals: 6,
    network: "eip155:4217",
  },
  maxSlippageBps: 50,
  operationId: "attempt-1",
  signal: new AbortController().signal,
  to: {
    owner: payer,
    asset: usdc,
    chainId: 8453,
    currency: "USD",
    decimals: 6,
    network: "eip155:8453",
  },
};

const approve = (spender: string, amount: bigint) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender as `0x${string}`, amount],
  });

const depositErc20 = (depositor: string, token: string, amount: bigint, id: Hex) =>
  encodeFunctionData({
    abi: relayDepositoryAbi,
    functionName: "depositErc20",
    args: [depositor as `0x${string}`, token as `0x${string}`, amount, id],
  });

const tx = (to: string, data: string) => ({ chainId: 4217, from: wallet, to, value: "0", data });

/** A contract-deposit Relay quote for `request`, shaped like Relay's live Tempo quotes. */
function quote(
  change: (quote: Record<string, any>) => void = () => undefined,
): RelayProtocolRoute.ApiQuote {
  const value: Record<string, any> = {
    details: {
      sender: wallet,
      recipient: payer,
      currencyIn: { amount: "101300", currency: { chainId: 4217, address: ousd } },
      currencyOut: { amount: "100000", currency: { chainId: 8453, address: usdc } },
    },
    protocol: { v2: { orderId } },
    steps: [
      {
        id: "approve",
        kind: "transaction",
        requestId,
        items: [{ status: "incomplete", data: tx(ousd, approve(depository, 101_300n)) }],
      },
      {
        id: "deposit",
        kind: "transaction",
        requestId,
        items: [
          {
            status: "incomplete",
            data: tx(depository, depositErc20(wallet, ousd, 101_300n, orderId)),
          },
        ],
      },
    ],
  };
  change(value);
  return value as RelayProtocolRoute.ApiQuote;
}

describe("Relay contract-deposit validation", () => {
  it("accepts exactly an approve to the depository and a deposit for the quoted order", () => {
    expect(relayContractDeposit(quote(), request, depository)).toEqual({
      requestId,
      token: ousd,
      amount: 101_300n,
      calls: [
        { to: ousd, data: approve(depository, 101_300n) },
        { to: depository, data: depositErc20(wallet, ousd, 101_300n, orderId) },
      ],
    });
  });

  it("accepts a deposit up to the quoted input plus slippage", () => {
    const within = quote((q) => {
      q.steps[0].items[0].data.data = approve(depository, 101_807n);
      q.steps[1].items[0].data.data = depositErc20(wallet, ousd, 101_807n, orderId);
    });
    expect(relayContractDeposit(within, request, depository).amount).toBe(101_807n);
  });

  it.each<[string, (quote: Record<string, any>) => void]>([
    ["delivers to another account", (q) => (q.details.recipient = wallet)],
    ["delivers another amount", (q) => (q.details.currencyOut.amount = "99999")],
    ["has only one step", (q) => q.steps.pop()],
    ["has an extra step", (q) => q.steps.push(structuredClone(q.steps[1]))],
    ["swaps its steps", (q) => q.steps.reverse()],
    ["approves another spender", (q) => (q.steps[0].items[0].data.data = approve(other, 101_300n))],
    ["approves on another token", (q) => (q.steps[0].items[0].data.to = usdc)],
    [
      "approves more than it deposits",
      (q) => (q.steps[0].items[0].data.data = approve(depository, 101_301n)),
    ],
    ["deposits into another contract", (q) => (q.steps[1].items[0].data.to = other)],
    [
      "credits another depositor",
      (q) => (q.steps[1].items[0].data.data = depositErc20(other, ousd, 101_300n, orderId)),
    ],
    [
      "deposits another token",
      (q) => (q.steps[1].items[0].data.data = depositErc20(wallet, usdc, 101_300n, orderId)),
    ],
    [
      "deposits for another order",
      (q) =>
        (q.steps[1].items[0].data.data = depositErc20(
          wallet,
          ousd,
          101_300n,
          `0x${"ee".repeat(32)}`,
        )),
    ],
    ["has no order ID", (q) => delete q.protocol],
    [
      "deposits above the slippage bound",
      (q) => {
        q.steps[0].items[0].data.data = approve(depository, 101_808n);
        q.steps[1].items[0].data.data = depositErc20(wallet, ousd, 101_808n, orderId);
      },
    ],
    [
      "deposits less than quoted",
      (q) => {
        q.steps[0].items[0].data.data = approve(depository, 101_299n);
        q.steps[1].items[0].data.data = depositErc20(wallet, ousd, 101_299n, orderId);
      },
    ],
    ["sends value", (q) => (q.steps[1].items[0].data.value = "1")],
    ["runs on another chain", (q) => (q.steps[1].items[0].data.chainId = 8453)],
    ["is sent from another account", (q) => (q.steps[0].items[0].data.from = payer)],
    [
      "appends calldata",
      (q) => (q.steps[1].items[0].data.data = `${depositErc20(wallet, ousd, 101_300n, orderId)}00`),
    ],
    [
      "transfers instead of approving",
      (q) =>
        (q.steps[0].items[0].data.data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [depository, 101_300n],
        })),
    ],
    ["mixes requests", (q) => (q.steps[0].requestId = `0x${"ef".repeat(32)}`)],
    ["has no request ID", (q) => delete q.steps[1].requestId],
  ])("rejects a quote that %s", (_name, change) => {
    expect(() => relayContractDeposit(quote(change), request, depository)).toThrow(
      /^Relay quote rejected: /,
    );
  });
});

describe("Relay route in contract-deposit mode", () => {
  function route(body: unknown, sent: unknown[] = [], held?: bigint) {
    const requests: Record<string, unknown>[] = [];
    const fetch = (async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json(body);
    }) as typeof globalThis.fetch;
    return {
      requests,
      route: relayDepositRoute({
        url: "http://relay.test",
        fetch,
        depository,
        maxGas: 20_000n,
        ...(held === undefined ? {} : { balance: async () => held }),
        execute: async (deposit) => {
          sent.push(deposit.calls);
        },
      }),
    };
  }

  it("asks Relay for a contract deposit, never a strict deposit address", async () => {
    const { requests, route: relay } = route(quote());
    await relay.quote(request);
    expect(requests[0]).toMatchObject({ includeProtocolData: true, tradeType: "EXACT_OUTPUT" });
    expect(requests[0]).not.toHaveProperty("strict");
    expect(requests[0]).not.toHaveProperty("useDepositAddress");
  });

  it("submits exactly the re-encoded approve and deposit", async () => {
    const sent: unknown[] = [];
    const { route: relay } = route(quote(), sent);
    const quoted = await relay.quote(request);
    await expect(
      relay.submit({
        quote: quoted,
        request,
        limits: { maxAmountIn: quoted.maxAmountIn, fees: quoted.fees, expiresAt: quoted.expiresAt },
      } as never),
    ).resolves.toEqual({ reference: requestId });
    expect(sent).toEqual([
      [
        { to: ousd, data: approve(depository, 101_300n) },
        { to: depository, data: depositErc20(wallet, ousd, 101_300n, orderId) },
      ],
    ]);
  });

  it("explains why routes declined when none can fund the payment", () => {
    const error = new Funder.NoRouteError("No trusted cross-chain route can fund the payment", {
      cause: new AggregateError([
        new Error("Relay quote rejected: it approves a spender other than Relay's depository"),
        new Error("Stargate cannot bridge this amount right now"),
      ]),
    });
    expect(
      fundingError(error, {
        network: parseNetwork("mainnet"),
        policy: {},
        maxSpendExceeded: () => walletError({ code: "E_RUNTIME", message: "unexpected" }),
      }),
    ).toMatchObject({
      code: "E_PAYMENT",
      message:
        "No trusted cross-chain route can fund the payment: Relay quote rejected: it approves a spender other than Relay's depository; Stargate cannot bridge this amount right now",
    });
  });

  it("names the source token when funding would exceed --max-funding-spend", () => {
    const error = new Funder.NoRouteError("No trusted cross-chain route can fund the payment", {
      cause: new AggregateError([new FundingLimitError(51_303n, 0n, ousd)]),
    });
    expect(
      fundingError(error, {
        network: parseNetwork("mainnet"),
        policy: {},
        maxSpendExceeded: () => walletError({ code: "E_RUNTIME", message: "unexpected" }),
      }),
    ).toMatchObject({
      code: "E_LIMIT_EXCEEDED",
      message: expect.stringContaining("needs up to 0.051303 OUSD, the bridge's fee"),
    });
  });

  it("refuses a quote the wallet's balance cannot cover, before signing", async () => {
    const sent: unknown[] = [];
    await expect(route(quote(), sent, 101_299n).route.quote(request)).rejects.toBeInstanceOf(
      SourceBalanceError,
    );
    await expect(route(quote(), sent, 101_300n).route.quote(request)).resolves.toMatchObject({
      maxAmountIn: 101_300n,
    });
    expect(sent).toHaveLength(0);
  });

  const report = (error: unknown) =>
    fundingError(error, {
      network: parseNetwork("mainnet"),
      policy: {},
      maxSpendExceeded: () => walletError({ code: "E_RUNTIME", message: "unexpected" }),
    });

  it.each([
    ["Relay first", [51_303n, 288_431n]],
    ["Stargate first", [288_431n, 51_303n]],
  ])("reports the cheapest route over the cap whichever refused first (%s)", (_name, amounts) => {
    const error = new Funder.NoRouteError("No trusted cross-chain route can fund the payment", {
      cause: new AggregateError(amounts.map((amount) => new FundingLimitError(amount, 0n, ousd))),
    });
    expect(report(error)).toMatchObject({
      code: "E_LIMIT_EXCEEDED",
      message: expect.stringContaining("needs up to 0.051303 OUSD"),
    });
  });

  it("reports a source shortfall as insufficient funds with what the wallet holds", () => {
    const error = new Funder.NoRouteError("No trusted cross-chain route can fund the payment", {
      cause: new AggregateError([
        new SourceBalanceError(268_432n, 14_030n, ousd),
        new SourceBalanceError(31_305n, 14_030n, ousd),
      ]),
    });
    expect(report(error)).toMatchObject({
      code: "E_INSUFFICIENT_FUNDS",
      message: expect.stringContaining(
        "needs 0.031305 OUSD, the bridge's fee included, and the wallet holds 0.01403; nothing was sent",
      ),
    });
  });

  it("prefers the cap over a shortfall when some route only exceeded the cap", () => {
    const error = new Funder.NoRouteError("No trusted cross-chain route can fund the payment", {
      cause: new AggregateError([
        new SourceBalanceError(268_432n, 100_000n, ousd),
        new FundingLimitError(51_303n, 0n, ousd),
      ]),
    });
    expect(report(error)).toMatchObject({ code: "E_LIMIT_EXCEEDED" });
  });
});
