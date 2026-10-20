import { Funder } from "machine-fetch";
import type { CrossChain } from "machine-fetch/cross-chain";
import type { RelayProtocolRoute } from "machine-fetch/relay";
import { encodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";

import { fundingError } from "../src/payment/funding.js";
import {
  RelayFundingLimitError,
  relayDeposit,
  relayDepositRoute,
} from "../src/payment/upstream/relay-route.js";
import { walletError } from "../src/shared/errors.js";
import { parseNetwork } from "../src/shared/network.js";

const ousd = "0x20c0000000000000000000006a37DA5C996874BE";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const wallet = "0x00000000000000000000000000000000000000a1";
const payer = "0x00000000000000000000000000000000000000b2";
const deposit = "0x00000000000000000000000000000000000000d3";
const requestId = `0x${"ab".repeat(32)}`;

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

const transfer = (to: string, amount: bigint) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to as `0x${string}`, amount],
  });

/** A Relay quote for `request`, with `change` applied. */
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
    steps: [
      {
        id: "deposit",
        kind: "transaction",
        requestId,
        depositAddress: deposit,
        items: [
          {
            status: "incomplete",
            data: {
              chainId: 4217,
              from: wallet,
              to: ousd,
              value: "0",
              data: transfer(deposit, 101_300n),
            },
          },
        ],
      },
    ],
  };
  change(value);
  return value as RelayProtocolRoute.ApiQuote;
}

describe("Relay deposit validation", () => {
  it("accepts exactly one transfer of the source token to the deposit address", () => {
    expect(relayDeposit(quote(), request)).toEqual({
      requestId,
      token: ousd,
      amount: 101_300n,
      calls: [{ to: ousd, data: transfer(deposit, 101_300n) }],
    });
  });

  it("accepts a transfer up to the quoted input plus slippage", () => {
    const within = quote((q) => (q.steps[0].items[0].data.data = transfer(deposit, 101_807n)));
    expect(relayDeposit(within, request).amount).toBe(101_807n);
  });

  it.each<[string, (quote: Record<string, any>) => void]>([
    ["delivers to another account", (q) => (q.details.recipient = wallet)],
    ["delivers on another chain", (q) => (q.details.currencyOut.currency.chainId = 1)],
    ["delivers another token", (q) => (q.details.currencyOut.currency.address = ousd)],
    ["delivers another amount", (q) => (q.details.currencyOut.amount = "99999")],
    ["has no steps", (q) => (q.steps = [])],
    ["has an extra step", (q) => q.steps.push(structuredClone(q.steps[0]))],
    ["has two items", (q) => q.steps[0].items.push(structuredClone(q.steps[0].items[0]))],
    ["is a signature step", (q) => (q.steps[0].kind = "signature")],
    ["runs on another chain", (q) => (q.steps[0].items[0].data.chainId = 8453)],
    ["calls an arbitrary contract", (q) => (q.steps[0].items[0].data.to = deposit)],
    ["is sent from another account", (q) => (q.steps[0].items[0].data.from = payer)],
    ["sends value", (q) => (q.steps[0].items[0].data.value = "1")],
    [
      "approves instead",
      (q) =>
        (q.steps[0].items[0].data.data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [deposit, 101_300n],
        })),
    ],
    [
      "appends calldata",
      (q) => (q.steps[0].items[0].data.data = `${transfer(deposit, 101_300n)}00`),
    ],
    ["pays another address", (q) => (q.steps[0].items[0].data.data = transfer(payer, 101_300n))],
    [
      "sends above the slippage bound",
      (q) => (q.steps[0].items[0].data.data = transfer(deposit, 101_808n)),
    ],
    [
      "sends less than quoted",
      (q) => (q.steps[0].items[0].data.data = transfer(deposit, 101_299n)),
    ],
    ["has no deposit address", (q) => delete q.steps[0].depositAddress],
    ["has no request ID", (q) => delete q.steps[0].requestId],
  ])("rejects a quote that %s", (_name, change) => {
    expect(() => relayDeposit(quote(change), request)).toThrow(/^Relay quote rejected: /);
  });
});

describe("Relay deposit route", () => {
  /** A route whose Relay API answers with `body` for quotes and `status` for status lookups. */
  function route(options: { body?: unknown; status?: unknown; maxSpend?: bigint } = {}) {
    const fetch = (async (url: string) => {
      if (url.endsWith("/quote/v2")) return Response.json(options.body ?? quote());
      return options.status === 404
        ? new Response("", { status: 404 })
        : Response.json({ status: options.status });
    }) as typeof globalThis.fetch;
    return relayDepositRoute({
      url: "http://relay.test",
      fetch,
      maxGas: 20_000n,
      maxSpend: options.maxSpend,
      execute: async () => undefined,
    });
  }

  it("bounds the quote by the deposit and reports the deposit's gas", async () => {
    const quoted = await route().quote(request);
    expect(quoted).toMatchObject({
      amountIn: 101_300n,
      maxAmountIn: 101_300n,
      reference: requestId,
      fees: [{ kind: "gas", asset: ousd, amount: 20_000n, includedInAmountIn: false }],
    });
    expect(quoted.expiresAt).toBeLessThanOrEqual(request.deadline);
  });

  it("refuses a quote over the funding ceiling, gas included, before signing", async () => {
    await expect(route({ maxSpend: 121_299n }).quote(request)).rejects.toBeInstanceOf(
      RelayFundingLimitError,
    );
    await expect(route({ maxSpend: 121_300n }).quote(request)).resolves.toMatchObject({
      maxAmountIn: 101_300n,
    });
  });

  it("refuses an expired quote", async () => {
    const expired = { ...quote(), expiresAt: Math.floor(Date.now() / 1000) - 1 };
    await expect(route({ body: expired }).quote(request)).rejects.toThrow("Relay quote is expired");
  });

  it.each([
    ["waiting", "pending"],
    ["pending", "pending"],
    ["delayed", "pending"],
    ["success", "completed"],
    ["refund", "refunded"],
    ["failure", "actionRequired"],
    [404, "pending"],
  ])("maps Relay status %s to %s", async (relay, status) => {
    const operation = { id: "attempt-1", quote: { reference: requestId } } as never;
    await expect(
      route({ status: relay }).status(operation, { signal: new AbortController().signal }),
    ).resolves.toEqual({ status });
  });

  it("rejects a malformed status", async () => {
    const operation = { id: "attempt-1", quote: { reference: requestId } } as never;
    await expect(
      route({ status: "bogus" }).status(operation, { signal: new AbortController().signal }),
    ).rejects.toThrow("Relay status response is malformed");
  });

  it("maps a funding ceiling refusal among route failures to E_LIMIT_EXCEEDED", () => {
    const error = new Funder.NoRouteError("No trusted cross-chain route can fund the payment", {
      cause: new AggregateError([
        new Error("other"),
        new RelayFundingLimitError(121_300n, 100_000n),
      ]),
    });
    expect(
      fundingError(error, {
        network: parseNetwork("mainnet"),
        policy: {},
        maxSpendExceeded: () => walletError({ code: "E_RUNTIME", message: "unexpected" }),
      }),
    ).toMatchObject({
      code: "E_LIMIT_EXCEEDED",
      message: expect.stringContaining("rerun with --max-funding-spend 0.1213; nothing was sent"),
    });
  });
});
