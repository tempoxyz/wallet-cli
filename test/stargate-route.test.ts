import type { CrossChain } from "machine-fetch/cross-chain";
import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, type Hex, pad } from "viem";
import { describe, expect, it } from "vitest";

import { FundingLimitError, SourceBalanceError } from "../src/payment/upstream/funding-limit.js";
import {
  feeWrapperAbi,
  stargateAbi,
  stargateRoute,
} from "../src/payment/upstream/stargate-route.js";

const usdce = "0x20C000000000000000000000b9537d11c60E8b50";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const oft = "0x8c76e2F6C5ceDA9AA7772e7efF30280226c44392";
const wrapper = "0x0cEb237E109eE22374a567c6b09F373C73FA4cBb";
const wallet = "0x00000000000000000000000000000000000000a1";
const payer = "0x00000000000000000000000000000000000000b2";
const hash = `0x${"12".repeat(32)}` as Hex;

const request: CrossChain.Request = {
  amountOut: 1_000_000n,
  deadline: Math.floor(Date.now() / 1000) + 30,
  from: {
    owner: wallet,
    asset: usdce,
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

type Options = Partial<Parameters<typeof stargateRoute>[0]> & {
  feeBps?: bigint;
  nativeFee?: bigint;
  lzTokenFee?: bigint;
  maxAmountLD?: bigint;
  scan?: (url: string) => Response;
};

/** A route over a stubbed OFT that charges `feeBps` and a flat `nativeFee` messaging fee. */
function route(options: Options = {}) {
  const feeBps = options.feeBps ?? 1n;
  const reads: { functionName: string; args: readonly unknown[] }[] = [];
  const executed: (readonly { to: string; data: Hex }[])[] = [];
  const client = {
    async readContract({ functionName, args }: { functionName: string; args: readonly unknown[] }) {
      reads.push({ functionName, args });
      const [param] = args as [{ amountLD: bigint }];
      if (functionName === "quoteOFT")
        return [
          { minAmountLD: 1n, maxAmountLD: options.maxAmountLD ?? 10n ** 12n },
          [],
          {
            amountSentLD: param.amountLD,
            amountReceivedLD: param.amountLD - (param.amountLD * feeBps) / 10_000n,
          },
        ];
      return { nativeFee: options.nativeFee ?? 258_429n, lzTokenFee: options.lzTokenFee ?? 0n };
    },
  };
  const fetch = (async (url: string) =>
    options.scan?.(url) ??
    Response.json({ data: [{ status: { name: "DELIVERED" } }] })) as typeof globalThis.fetch;
  const stargate = stargateRoute({
    oft,
    token: usdce,
    feeWrapper: wrapper,
    endpointIds: { "8453": 30184 },
    destinationToken: (chainId) => (chainId === 8453 ? usdc : undefined),
    client,
    maxGas: 20_000n,
    fetch,
    execute: async (calls) => {
      executed.push(calls);
      return hash;
    },
    ...options,
  });
  return { stargate, reads, executed };
}

describe("Stargate route quotes", () => {
  it("sizes the send so the receipt covers exactly the output, and reports the messaging fee", async () => {
    const { stargate, reads } = route();
    const quoted = await stargate.quote(request);
    // 1 bp: 1,000,100 sent receives 1,000,000 (rounded down by the OFT).
    // The messaging fee is debited in USDC.e too, so it counts toward the input routes are ranked by.
    expect(quoted).toMatchObject({
      amountIn: 1_258_529n,
      maxAmountIn: 1_258_529n,
      amountOut: 1_000_000n,
      minAmountOut: 1_000_000n,
      fees: [
        { kind: "provider", asset: usdce, amount: 258_429n, includedInAmountIn: true },
        { kind: "gas", asset: usdce, amount: 20_000n, includedInAmountIn: false },
      ],
    });
    const last = reads.at(-1)!;
    expect(last.functionName).toBe("quoteSend");
    expect(last.args[0]).toMatchObject({
      dstEid: 30184,
      to: pad(payer),
      minAmountLD: 1_000_000n,
      oftCmd: "0x",
    });
    expect(quoted.expiresAt).toBeLessThanOrEqual(request.deadline);
  });

  it("refuses a quote over the funding ceiling, fee and gas included, before signing", async () => {
    // 1,000,100 + 258,429 + 20,000 = 1,278,529
    await expect(route({ maxSpend: 1_278_528n }).stargate.quote(request)).rejects.toBeInstanceOf(
      FundingLimitError,
    );
    await expect(route({ maxSpend: 1_278_529n }).stargate.quote(request)).resolves.toMatchObject({
      maxAmountIn: 1_258_529n,
    });
  });

  it.each<[string, Partial<CrossChain.Request> | ((r: CrossChain.Request) => CrossChain.Request)]>([
    ["another source token", (r) => ({ ...r, from: { ...r.from, asset: usdc } })],
    ["an unconfigured destination", (r) => ({ ...r, to: { ...r.to, chainId: 10 } })],
    ["another destination token", (r) => ({ ...r, to: { ...r.to, asset: usdce } })],
  ])("declines %s", async (_name, change) => {
    const changed = typeof change === "function" ? change(request) : { ...request, ...change };
    await expect(route().stargate.quote(changed)).rejects.toThrow(/^Stargate route declined: /);
  });

  it("refuses a quote the wallet's balance cannot cover, fee included, before signing", async () => {
    // 1,000,100 sent plus the 258,429 fee.
    const short = route({ balance: async () => 1_258_528n });
    await expect(short.stargate.quote(request)).rejects.toBeInstanceOf(SourceBalanceError);
    expect(short.executed).toHaveLength(0);
    await expect(
      route({ balance: async () => 1_258_529n }).stargate.quote(request),
    ).resolves.toMatchObject({
      maxAmountIn: 1_258_529n,
    });
  });

  it("refuses an amount above the OFT's limit", async () => {
    await expect(route({ maxAmountLD: 999_999n }).stargate.quote(request)).rejects.toThrow(
      "Stargate cannot bridge this amount right now",
    );
  });

  it.each([
    ["an LZ token fee", { lzTokenFee: 1n }],
    ["a zero messaging fee", { nativeFee: 0n }],
  ])("refuses a messaging fee quote with %s", async (_name, options) => {
    await expect(route(options).stargate.quote(request)).rejects.toThrow(
      "Stargate messaging fee quote is malformed",
    );
  });
});

describe("Stargate route submission", () => {
  it("sends exactly the fee wrap, approvals, and sendToken in one batch", async () => {
    const { stargate, executed } = route();
    const quoted = await stargate.quote(request);
    await expect(
      stargate.submit({
        quote: quoted,
        request,
        limits: { maxAmountIn: quoted.maxAmountIn, fees: quoted.fees, expiresAt: quoted.expiresAt },
      } as never),
    ).resolves.toEqual({ reference: hash });
    expect(executed).toHaveLength(1);
    const [calls] = executed;
    const approve = (spender: string, amount: bigint) =>
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender as Hex, amount],
      });
    expect(calls!.slice(0, 4)).toEqual([
      { to: usdce, data: approve(wrapper, 258_429n) },
      {
        to: wrapper,
        data: encodeFunctionData({
          abi: feeWrapperAbi,
          functionName: "wrap",
          args: [usdce, wallet, 258_429n],
        }),
      },
      { to: wrapper, data: approve(oft, 258_429n) },
      { to: usdce, data: approve(oft, 1_000_100n) },
    ]);
    const send = decodeFunctionData({ abi: stargateAbi, data: calls![4]!.data });
    expect(calls![4]!.to).toBe(oft);
    expect(send.functionName).toBe("sendToken");
    expect(send.args).toEqual([
      {
        dstEid: 30184,
        to: pad(payer),
        amountLD: 1_000_100n,
        minAmountLD: 1_000_000n,
        extraOptions: "0x",
        composeMsg: "0x",
        oftCmd: "0x",
      },
      { nativeFee: 258_429n, lzTokenFee: 0n },
      getAddress(wallet),
    ]);
  });

  it("refuses saved quote data that disagrees with the bounded quote", async () => {
    const { stargate, executed } = route();
    const quoted = await stargate.quote(request);
    const tampered = { ...quoted, data: { ...(quoted.data as object), amountLD: 2_000_000n } };
    await expect(
      stargate.submit({ quote: tampered, request, limits: tampered } as never),
    ).rejects.toThrow("Stargate quote data is malformed");
    expect(executed).toHaveLength(0);
  });
});

describe("Stargate route status", () => {
  const operation = (reference?: string) =>
    ({
      operationId: "attempt-1",
      route: "stargate",
      reference,
      quote: { reference: "stargate:attempt-1" },
    }) as never;
  const signal = new AbortController().signal;

  it.each([
    ["DELIVERED", "completed"],
    ["INFLIGHT", "pending"],
    ["CONFIRMING", "pending"],
    ["FAILED", "actionRequired"],
    ["BLOCKED", "actionRequired"],
    ["PAYLOAD_STORED", "actionRequired"],
  ])("maps LayerZero status %s to %s", async (name, status) => {
    const { stargate } = route({ scan: () => Response.json({ data: [{ status: { name } }] }) });
    await expect(stargate.status(operation(hash), { signal })).resolves.toEqual({
      status,
      ...(status === "completed" ? { destinationTxs: [] } : {}),
    });
  });

  it("names the destination transaction LayerZero reports delivering the message", async () => {
    const delivered = `0x${"de".repeat(32)}`;
    const { stargate } = route({
      scan: () =>
        Response.json({
          data: [{ status: { name: "DELIVERED" }, destination: { tx: { txHash: delivered } } }],
        }),
    });
    await expect(stargate.status(operation(hash), { signal })).resolves.toEqual({
      status: "completed",
      destinationTxs: [delivered],
    });
  });

  it("treats a message LayerZero has not indexed yet as pending", async () => {
    const notFound = route({ scan: () => new Response("", { status: 404 }) });
    await expect(notFound.stargate.status(operation(hash), { signal })).resolves.toEqual({
      status: "pending",
    });
    const empty = route({ scan: () => Response.json({ data: [] }) });
    await expect(empty.stargate.status(operation(hash), { signal })).resolves.toEqual({
      status: "pending",
    });
  });

  it("reports a reverted source transaction as refunded: nothing moved", async () => {
    const { stargate } = route({ reverted: async () => true });
    await expect(stargate.status(operation(hash), { signal })).resolves.toEqual({
      status: "refunded",
    });
  });

  it("needs reconciliation by hand without a transaction hash", async () => {
    await expect(route().stargate.status(operation(undefined), { signal })).resolves.toEqual({
      status: "actionRequired",
    });
  });

  it("rejects a malformed LayerZero response", async () => {
    const { stargate } = route({
      scan: () => Response.json({ data: [{ status: { name: "?" } }] }),
    });
    await expect(stargate.status(operation(hash), { signal })).rejects.toThrow(
      "LayerZero Scan response is malformed",
    );
  });
});
