/**
 * [MF-21] A ready-made Stargate route: exact-output funding of a Stargate token (USDC.e on Tempo)
 * into native USDC on another chain through Stargate's OFT `sendToken`, as a bounded machine-fetch
 * `CrossChainRoute`. Like the Relay route, every call is built from checked values; nothing comes
 * from a server.
 *
 * Tempo has no native gas token, so LayerZero's messaging fee is paid in LZD, which
 * LZEndpointDollar wraps from the bridged token. The route therefore sends five calls in one
 * atomic Tempo transaction: approve and wrap the fee, approve the fee to the OFT, approve the
 * amount to the OFT, and `sendToken` with `minAmountLD` equal to the exact output, so Stargate
 * reverts rather than deliver less.
 */
import { Funder } from "machine-fetch";
import type { CrossChain } from "machine-fetch/cross-chain";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  keccak256,
  pad,
  parseAbi,
} from "viem";

import { namedFetch, transactionHashes } from "./delivery.js";
import { FundingLimitError, SourceBalanceError } from "./funding-limit.js";

export const stargateAbi = parseAbi([
  "struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }",
  "struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }",
  "struct OFTLimit { uint256 minAmountLD; uint256 maxAmountLD; }",
  "struct OFTFeeDetail { int256 feeAmountLD; string description; }",
  "struct OFTReceipt { uint256 amountSentLD; uint256 amountReceivedLD; }",
  "function quoteSend(SendParam _sendParam, bool _payInLzToken) view returns (MessagingFee)",
  "function quoteOFT(SendParam _sendParam) view returns (OFTLimit, OFTFeeDetail[], OFTReceipt)",
  "function sendToken(SendParam _sendParam, MessagingFee _fee, address _refundAddress) payable",
]);

export const feeWrapperAbi = parseAbi(["function wrap(address token, address to, uint256 amount)"]);

/** The parts of a Tempo client the route reads quotes through. */
export type StargateReader = {
  readContract(parameters: {
    address: Address;
    abi: typeof stargateAbi;
    functionName: "quoteOFT" | "quoteSend";
    args: readonly unknown[];
  }): Promise<unknown>;
};

export type StargateRouteOptions = {
  /** Route name. @default stargate */
  name?: string;
  oft: Address;
  /** The source token the OFT bridges, such as USDC.e. */
  token: Address;
  /** LZEndpointDollar, which wraps `token` into the messaging-fee token. */
  feeWrapper: Address;
  /** LayerZero endpoint ID of each destination chain, by chain ID. */
  endpointIds: Record<string, number>;
  /** The token Stargate delivers on a destination chain, such as native USDC. */
  destinationToken(chainId: number): Address | undefined;
  client: StargateReader;
  /** Most the source transaction's gas may cost, in atomic units of `token`. */
  maxGas: bigint;
  /** Ceiling on the source debit, amount plus messaging fee plus gas; checked before signing. */
  maxSpend?: bigint | undefined;
  /**
   * The source account's balance of `token`. When given, a quote debiting more than it is refused
   * before anything is signed, instead of signing a send that would revert.
   */
  balance?(request: CrossChain.Request): Promise<bigint>;
  /** LayerZero Scan API base URL. @default https://scan.layerzero-api.com */
  scanUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Validity of a quote, in seconds; messaging fees move with gas prices. @default 30 */
  quoteTtlSeconds?: number;
  /**
   * Sign exactly `calls` as one atomic transaction that cannot land after `validBefore` (Unix
   * seconds), without broadcasting; resolve with the signed, serialized transaction.
   */
  sign(
    calls: readonly { to: Address; data: Hex }[],
    request: CrossChain.Request,
    validBefore: number,
  ): Promise<Hex>;
  /** Broadcast a transaction `sign` returned and wait for it; resolve with its hash. */
  broadcast(serialized: Hex): Promise<Hex>;
  /** Whether the source transaction `hash` reverted, so nothing moved; `undefined` if unknown. */
  reverted?(hash: Hex): Promise<boolean | undefined>;
  /**
   * Whether the source transaction `hash` can no longer land: the source chain is past `after`
   * (Unix seconds) and has no receipt for it. `false` when that cannot be read.
   */
  dropped?(hash: Hex, after: number): Promise<boolean>;
  /**
   * The transactions from block `fromBlock` on in which `owner` sent exactly `amountLD` through
   * the OFT to `dstEid` (its `OFTSent` events). Recovery uses it for an operation saved before the
   * route recorded its hash ahead of broadcasting, by a run killed after broadcasting a send but
   * before recording it.
   */
  findSent?(search: {
    owner: Address;
    dstEid: number;
    amountLD: bigint;
    fromBlock: bigint;
  }): Promise<readonly Hex[]>;
  onProgress?(
    event:
      | { type: "submitted"; hash: Hex; amount: bigint; fee: bigint; request: CrossChain.Request }
      | { type: "pending"; hash: Hex },
  ): void;
};

/** Quote data saved with an operation, so submission and recovery reuse the checked values. */
type StargateQuoteData = {
  dstEid: number;
  amountLD: bigint;
  nativeFee: bigint;
  /** When the send stops being valid on Tempo, in Unix seconds: the quote's expiry. */
  validBefore?: number | undefined;
  /**
   * The source chain's block when quoted, saved by earlier versions, which recorded the send's
   * hash only after broadcasting: no send for this operation is older.
   */
  fromBlock?: bigint | undefined;
};

/**
 * How long past a send's `validBefore` the source chain must be before a send with no receipt
 * counts as dropped, so a load-balanced RPC whose receipts lag its head cannot refund one that
 * landed.
 */
const droppedAfterSeconds = 60;

const scanStatuses: Record<string, "pending" | "completed" | "actionRequired"> = {
  INFLIGHT: "pending",
  CONFIRMING: "pending",
  PAYLOAD_STORED: "actionRequired",
  DELIVERED: "completed",
  FAILED: "actionRequired",
  BLOCKED: "actionRequired",
};

/** A bounded Stargate route from `token` on Tempo to native USDC on a configured destination. */
export function stargateRoute(
  options: StargateRouteOptions,
): CrossChain.Route<CrossChain.BoundedQuote> {
  const name = options.name ?? "stargate";
  const scanUrl = (options.scanUrl ?? "https://scan.layerzero-api.com").replace(/\/$/, "");
  const fetchJson = namedFetch("LayerZero Scan", options.fetch ?? globalThis.fetch);
  const ttl = options.quoteTtlSeconds ?? 30;

  const sendParam = (request: CrossChain.Request, dstEid: number, amountLD: bigint) => ({
    dstEid,
    to: pad(request.to.owner),
    amountLD,
    minAmountLD: request.amountOut,
    extraOptions: "0x" as Hex,
    composeMsg: "0x" as Hex,
    // Taxi: sent at once. Bus mode is not configured from Tempo.
    oftCmd: "0x" as Hex,
  });

  const check = (request: CrossChain.Request) => {
    const fail = (message: string) =>
      new Funder.FundingError(`Stargate route declined: ${message}`);
    if (request.from.asset.toLowerCase() !== options.token.toLowerCase())
      throw fail("the source token is not the OFT's token");
    const dstEid = options.endpointIds[String(request.to.chainId)];
    if (!dstEid) throw fail("Stargate is not configured for the destination chain");
    const delivered = options.destinationToken(request.to.chainId);
    if (!delivered || delivered.toLowerCase() !== request.to.asset.toLowerCase())
      throw fail("Stargate does not deliver the requested token");
    return dstEid;
  };

  /**
   * The one send an operation without a recorded hash made. Only operations saved before the
   * route recorded its hash ahead of broadcasting can lack one: a run killed between broadcasting
   * and recording left that window. None, several, or an unbounded search is left for a human.
   */
  const unrecordedSend = async (operation: CrossChain.Operation) => {
    const data = operation.quote.data as StargateQuoteData | undefined;
    if (!options.findSent || typeof data?.fromBlock !== "bigint") return undefined;
    const found = await options.findSent({
      owner: operation.request.from.owner,
      dstEid: data.dstEid,
      amountLD: data.amountLD,
      fromBlock: data.fromBlock,
    });
    return found.length === 1 ? found[0] : undefined;
  };

  return {
    name,
    async quote(request) {
      const dstEid = check(request);
      // The smallest amount whose receipt covers the exact output: scale up by the quoted fee
      // ratio (a few basis points), then step down while the receipt still covers it, since the
      // ratio's rounding can overshoot by a unit.
      const receive = async (amountLD: bigint) => {
        const [limit, , receipt] = (await options.client.readContract({
          address: options.oft,
          abi: stargateAbi,
          functionName: "quoteOFT",
          args: [sendParam(request, dstEid, amountLD)],
        })) as [{ maxAmountLD: bigint }, unknown, { amountReceivedLD: bigint }];
        if (amountLD > limit.maxAmountLD)
          throw new Funder.FundingError("Stargate cannot bridge this amount right now");
        return receipt.amountReceivedLD;
      };
      let amountLD = request.amountOut;
      for (let round = 0; ; round += 1) {
        const received = await receive(amountLD);
        if (received >= request.amountOut) break;
        if (round === 3 || received === 0n)
          throw new Funder.FundingError("Stargate quote does not cover the requested output");
        amountLD = (amountLD * request.amountOut + received - 1n) / received;
      }
      for (let step = 0; step < 2 && amountLD > request.amountOut; step += 1) {
        if ((await receive(amountLD - 1n)) < request.amountOut) break;
        amountLD -= 1n;
      }
      const { nativeFee, lzTokenFee } = (await options.client.readContract({
        address: options.oft,
        abi: stargateAbi,
        functionName: "quoteSend",
        args: [sendParam(request, dstEid, amountLD), false],
      })) as { nativeFee: bigint; lzTokenFee: bigint };
      if (lzTokenFee !== 0n || nativeFee <= 0n)
        throw new Funder.FundingError("Stargate messaging fee quote is malformed");
      if (options.balance) {
        const held = await options.balance(request);
        if (held < amountLD + nativeFee)
          throw new SourceBalanceError(amountLD + nativeFee, held, request.from.asset);
      }
      const required = amountLD + nativeFee + options.maxGas;
      if (options.maxSpend !== undefined && required > options.maxSpend)
        throw new FundingLimitError(required, options.maxSpend, request.from.asset);
      const expiresAt = Math.min(Math.floor(Date.now() / 1000) + ttl, request.deadline);
      const data: StargateQuoteData = { dstEid, amountLD, nativeFee, validBefore: expiresAt };
      // The messaging fee is debited in the same token, so it is part of the input: machine-fetch
      // ranks routes by `amountIn` alone ([MF-22]), and this keeps Stargate's flat fee in the
      // comparison with Relay.
      const debit = amountLD + nativeFee;
      return {
        amountIn: debit,
        maxAmountIn: debit,
        amountOut: request.amountOut,
        minAmountOut: request.amountOut,
        expiresAt,
        reference: `stargate:${request.operationId}`,
        data,
        fees: [
          {
            kind: "provider",
            network: request.from.network,
            asset: request.from.asset,
            amount: nativeFee,
            includedInAmountIn: true,
          },
          {
            kind: "gas",
            network: request.from.network,
            asset: request.from.asset,
            amount: options.maxGas,
            includedInAmountIn: false,
          },
        ],
      };
    },
    async submit({ quote, request, saveReference }) {
      const dstEid = check(request);
      const data = quote.data as StargateQuoteData | undefined;
      if (
        !data ||
        data.dstEid !== dstEid ||
        typeof data.amountLD !== "bigint" ||
        typeof data.nativeFee !== "bigint" ||
        data.amountLD + data.nativeFee !== quote.maxAmountIn ||
        data.validBefore !== quote.expiresAt
      )
        throw new Funder.FundingError("Stargate quote data is malformed");
      if (!saveReference)
        throw new Funder.FundingError(
          "The Stargate route must save its send's hash before sending",
        );
      const { amountLD, nativeFee, validBefore } = data;
      const calls = [
        {
          to: options.token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [options.feeWrapper, nativeFee],
          }),
        },
        {
          to: options.feeWrapper,
          data: encodeFunctionData({
            abi: feeWrapperAbi,
            functionName: "wrap",
            args: [options.token, request.from.owner, nativeFee],
          }),
        },
        {
          to: options.feeWrapper,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [options.oft, nativeFee],
          }),
        },
        {
          to: options.token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [options.oft, amountLD],
          }),
        },
        {
          to: options.oft,
          data: encodeFunctionData({
            abi: stargateAbi,
            functionName: "sendToken",
            args: [
              sendParam(request, dstEid, amountLD),
              { nativeFee, lzTokenFee: 0n },
              request.from.owner,
            ],
          }),
        },
      ] as const;
      const serialized = await options.sign(calls, request, validBefore);
      const hash = keccak256(serialized);
      // Saved before broadcasting: a run killed in between leaves the hash for `status` to find,
      // and a send that never lands is dropped once Tempo passes `validBefore`.
      await saveReference(hash);
      const sent = await options.broadcast(serialized);
      if (sent.toLowerCase() !== hash)
        throw new Funder.FundingError("The Stargate send's hash is not the one saved");
      options.onProgress?.({ type: "submitted", hash, amount: amountLD, fee: nativeFee, request });
      return { reference: hash };
    },
    async status(operation, { signal }): Promise<CrossChain.Status> {
      const hash = operation.reference ?? (await unrecordedSend(operation));
      // Without the transaction hash there is nothing to look up: reconcile by hand.
      if (!hash || !/^0x[\da-fA-F]{64}$/.test(hash)) return { status: "actionRequired" };
      const reverted = await options.reverted?.(hash as Hex);
      if (reverted === true) return { status: "refunded" };
      // A saved send that never landed, nor can any more, moved nothing.
      const { validBefore } = (operation.quote.data ?? {}) as StargateQuoteData;
      if (
        reverted === undefined &&
        typeof validBefore === "number" &&
        (await options.dropped?.(hash as Hex, validBefore + droppedAfterSeconds)) === true
      )
        return { status: "refunded" };
      const response = await fetchJson(`${scanUrl}/v1/messages/tx/${hash}`, { signal });
      if (response.status === 404) return { status: "pending" };
      if (!response.ok)
        throw new Funder.FundingError(`LayerZero Scan request failed with HTTP ${response.status}`);
      const body = (await response.json().catch(() => ({}))) as {
        data?: { status?: { name?: unknown }; destination?: { tx?: { txHash?: unknown } } }[];
      };
      const first = body.data?.[0]?.status?.name;
      if (body.data?.length === 0) return { status: "pending" };
      const status = typeof first === "string" ? scanStatuses[first] : undefined;
      if (!status) throw new Funder.FundingError("LayerZero Scan response is malformed");
      if (status === "pending") options.onProgress?.({ type: "pending", hash: hash as Hex });
      if (status !== "completed") return { status };
      return { status, destinationTxs: transactionHashes(body.data?.[0]?.destination?.tx?.txHash) };
    },
  };
}
