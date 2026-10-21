/**
 * [MF-2] A ready-made Relay route: machine-fetch's `relayProtocol()` fetches and parses a quote,
 * and every integrator must still write `guarantees`, `submit`, and `status`, the security-critical
 * part. This is that part, for both ways Relay takes funds on the source chain:
 *
 * - single-use deposit addresses, where the source-side step is one ERC-20/TIP-20 `transfer` of
 *   the source token to the deposit address; Relay offers these strictly (exact output) only on
 *   some origins, and not on Tempo;
 * - contract deposits, where the source-side steps are `approve(depository, amount)` on the source
 *   token and `depositErc20(depositor, token, amount, orderId)` on Relay's depository, which the
 *   application pins: a quote never chooses the spender.
 *
 * Either way the route validates every step, re-encodes the calls from the checked values, and
 * hands the application exactly those calls to sign and send atomically. Proven here by the CLI's
 * hostile-quote tests, then lifted into machine-fetch.
 */
import { Funder } from "machine-fetch";
import type { CrossChain } from "machine-fetch/cross-chain";
import { RelayProtocolRoute } from "machine-fetch/relay";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  parseAbi,
} from "viem";

import { namedFetch, transactionHashes } from "./delivery.js";
import { FundingLimitError, SourceBalanceError } from "./funding-limit.js";

/** Relay's v2 depository entry point for ERC-20 (TIP-20) deposits. */
export const relayDepositoryAbi = parseAbi([
  "function depositErc20(address depositor, address token, uint256 amount, bytes32 id)",
]);

/** One validated source-chain call, re-encoded from checked values. */
export type RelayCall = { to: Address; data: Hex };

/** A quote's validated source-side deposit: the only funds-moving actions a quote may ask for. */
export type RelayDeposit = {
  /** Relay's request ID, used for status and recovery. */
  requestId: string;
  token: Address;
  /** The source debit, before gas. */
  amount: bigint;
  /** Exactly the calls to send, in order and atomically, on the source chain. */
  calls: readonly RelayCall[];
};

/** Refused because the funding would exceed the application's source-side ceiling. */
export class RelayFundingLimitError extends FundingLimitError {
  override readonly name: string = "RelayFundingLimitError";
}

export type RelayDepositRouteOptions = {
  /** Route name. @default relay */
  name?: string;
  /** Relay API base URL. @default https://api.relay.link */
  url?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * Relay's depository on the source chain. When set, the route asks for a contract deposit and
   * accepts only an approve to, and a deposit into, this contract; otherwise it asks for a strict
   * single-use deposit address.
   */
  depository?: Address | undefined;
  /** Most the source-side transaction's gas may cost, in atomic units of the source token. */
  maxGas: bigint;
  /** Ceiling on the source debit, deposit plus gas; checked before anything is signed. */
  maxSpend?: bigint | undefined;
  /**
   * The source account's balance of the source token. When given, a quote debiting more than it
   * is refused before anything is signed, instead of signing a deposit that would revert.
   */
  balance?(request: CrossChain.Request): Promise<bigint>;
  /** Validity of a quote that carries no `expiresAt`, in seconds. @default 60 */
  quoteTtlSeconds?: number;
  /** Sign and broadcast exactly `deposit.calls`, atomically; resolve once they are accepted. */
  execute(deposit: RelayDeposit, request: CrossChain.Request): Promise<void>;
  /** Observes progress without affecting it, for example to print it. */
  onProgress?(
    event:
      | { type: "submitted"; deposit: RelayDeposit; request: CrossChain.Request }
      | { type: "pending"; requestId: string },
  ): void;
};

const relayStatuses: Record<string, "pending" | "completed" | "refunded" | "actionRequired"> = {
  waiting: "pending",
  pending: "pending",
  submitted: "pending",
  delayed: "pending",
  success: "completed",
  refund: "refunded",
  refunded: "refunded",
  failure: "actionRequired",
};

/** A bounded Relay route, with every quote validated against the configured deposit mode. */
export function relayDepositRoute(
  options: RelayDepositRouteOptions,
): CrossChain.Route<CrossChain.BoundedQuote> {
  const url = (options.url ?? "https://api.relay.link").replace(/\/$/, "");
  const fetchJson = namedFetch("Relay", options.fetch ?? globalThis.fetch);
  const ttl = options.quoteTtlSeconds ?? 60;
  const validate = (quote: RelayProtocolRoute.ApiQuote, request: CrossChain.Request) =>
    options.depository
      ? relayContractDeposit(quote, request, options.depository)
      : relayDeposit(quote, request);
  return RelayProtocolRoute.create({
    name: options.name ?? "relay",
    url,
    fetch: fetchJson,
    useDepositAddress: !options.depository,
    async guarantees({ quote, request }) {
      const deposit = validate(quote, request);
      if (options.balance) {
        const held = await options.balance(request);
        if (held < deposit.amount)
          throw new SourceBalanceError(deposit.amount, held, request.from.asset);
      }
      const required = deposit.amount + options.maxGas;
      if (options.maxSpend !== undefined && required > options.maxSpend)
        throw new RelayFundingLimitError(required, options.maxSpend, request.from.asset);
      const now = Math.floor(Date.now() / 1000);
      const quoted = quote.expiresAt;
      if (quoted !== undefined && (!Number.isSafeInteger(quoted) || (quoted as number) <= now))
        throw new Funder.FundingError("Relay quote is expired");
      return {
        maxAmountIn: deposit.amount,
        fees: [
          {
            kind: "gas",
            network: request.from.network,
            asset: request.from.asset,
            amount: options.maxGas,
            includedInAmountIn: false,
          },
        ],
        expiresAt: Math.min((quoted as number | undefined) ?? now + ttl, request.deadline),
      };
    },
    async submit({ quote, limits, request }) {
      // Revalidated from the saved quote: nothing reaches the signer that guarantees did not check.
      const deposit = validate(quote, request);
      if (deposit.amount > limits.maxAmountIn)
        throw new Funder.FundingError("Relay deposit exceeds its maximum input");
      await options.execute(deposit, request);
      options.onProgress?.({ type: "submitted", deposit, request });
      return { reference: deposit.requestId };
    },
    async status(operation, { signal }): Promise<CrossChain.Status> {
      const requestId = operation.reference ?? operation.quote.reference;
      const response = await fetchJson(
        `${url}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`,
        { signal },
      );
      if (response.status === 404) return { status: "pending" };
      if (!response.ok)
        throw new Funder.FundingError(`Relay status request failed with HTTP ${response.status}`);
      const body = (await response.json().catch(() => ({}))) as {
        status?: unknown;
        txHashes?: unknown;
      };
      const status = typeof body.status === "string" ? relayStatuses[body.status] : undefined;
      if (!status) throw new Funder.FundingError("Relay status response is malformed");
      if (status === "pending") options.onProgress?.({ type: "pending", requestId });
      if (status !== "completed") return { status };
      return { status, destinationTxs: transactionHashes(body.txHashes) };
    },
  });
}

const fail = (message: string) => new Funder.FundingError(`Relay quote rejected: ${message}`);

/**
 * The single transfer a deposit-address quote may ask for, or a FundingError: exactly one
 * transaction step with one item, on the source chain, from the source account, calling the source
 * token's `transfer` with no value or extra data, to the step's deposit address, for at least the
 * quoted input and at most that plus slippage. Relay must deliver exactly the requested output of
 * the destination token to the destination account.
 */
export function relayDeposit(
  quote: RelayProtocolRoute.ApiQuote,
  request: CrossChain.Request,
): RelayDeposit {
  checkDelivery(quote, request);
  const { steps } = quote;
  if (steps.length !== 1) throw fail("it must have exactly one step");
  const [step] = steps;
  const tx = sourceTransaction(step, request);
  if (!same(tx.to, request.from.asset))
    throw fail("its transaction calls a contract other than the source token");
  const requestId = stepRequestId(step);
  const depositAddress = step?.depositAddress;
  if (typeof depositAddress !== "string" || !/^0x[\da-fA-F]{40}$/.test(depositAddress))
    throw fail("it has no deposit address");
  const transfer = decodeExact(tx.data, "transfer", 2);
  if (!transfer) throw fail("its transaction is not a token transfer");
  const [recipient, amount] = transfer as [string, bigint];
  if (!same(recipient, depositAddress)) throw fail("its transfer is not to the deposit address");
  checkAmount(amount, quote, request, "its transfer amount");
  return {
    requestId,
    token: request.from.asset,
    amount,
    calls: [
      {
        to: request.from.asset,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [depositAddress as Address, amount],
        }),
      },
    ],
  };
}

/**
 * The approve and deposit a contract-deposit quote may ask for, or a FundingError: exactly two
 * transaction steps of one item each, on the source chain, from the source account, with no value:
 * first `approve(depository, amount)` on the source token, then
 * `depositErc20(source account, source token, amount, orderId)` on the pinned `depository`, where
 * `orderId` is the quote's `protocol.v2.orderId` and `amount` is at least the quoted input and at
 * most that plus slippage. Relay must deliver exactly the requested output of the destination token
 * to the destination account.
 */
export function relayContractDeposit(
  quote: RelayProtocolRoute.ApiQuote,
  request: CrossChain.Request,
  depository: Address,
): RelayDeposit {
  checkDelivery(quote, request);
  const { steps } = quote;
  if (steps.length !== 2) throw fail("it must have exactly an approve and a deposit step");
  const [approveStep, depositStep] = steps;
  const approveTx = sourceTransaction(approveStep, request);
  const depositTx = sourceTransaction(depositStep, request);
  if (!same(approveTx.to, request.from.asset))
    throw fail("its approval is not on the source token");
  const approval = decodeExact(approveTx.data, "approve", 2);
  if (!approval) throw fail("its first step is not a token approval");
  const [spender, approved] = approval as [string, bigint];
  if (!same(spender, depository)) throw fail("it approves a spender other than Relay's depository");
  if (!same(depositTx.to, depository)) throw fail("its deposit is not into Relay's depository");
  const deposit = decodeDeposit(depositTx.data);
  if (!deposit) throw fail("its second step is not a depository deposit");
  const [depositor, token, amount, id] = deposit;
  if (!same(depositor, request.from.owner)) throw fail("its deposit credits another account");
  if (!same(token, request.from.asset)) throw fail("its deposit is of another token");
  if (amount !== approved) throw fail("its approval and deposit amounts differ");
  const orderId = protocolOrderId(quote);
  if (!orderId || id.toLowerCase() !== orderId.toLowerCase())
    throw fail("its deposit is not for the quoted order");
  const requestId = stepRequestId(depositStep);
  if (approveStep?.requestId !== undefined && approveStep.requestId !== requestId)
    throw fail("its steps belong to different requests");
  checkAmount(amount, quote, request, "its deposit amount");
  return {
    requestId,
    token: request.from.asset,
    amount,
    calls: [
      {
        to: request.from.asset,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [depository, amount],
        }),
      },
      {
        to: depository,
        data: encodeFunctionData({
          abi: relayDepositoryAbi,
          functionName: "depositErc20",
          args: [request.from.owner, request.from.asset, amount, id as Hex],
        }),
      },
    ],
  };
}

type Step = RelayProtocolRoute.ApiQuote["steps"][number] | undefined;

/** Relay must deliver exactly the requested output of the destination token to the payer. */
function checkDelivery(quote: RelayProtocolRoute.ApiQuote, request: CrossChain.Request) {
  const { details } = quote;
  if (
    details.currencyOut.currency.chainId !== request.to.chainId ||
    !same(details.currencyOut.currency.address, request.to.asset) ||
    !same(details.recipient, request.to.owner) ||
    details.currencyOut.amount !== request.amountOut.toString()
  )
    throw fail("it does not deliver the requested output to the destination account");
}

/** A step's one transaction, checked to run on the source chain from the source account. */
function sourceTransaction(step: Step, request: CrossChain.Request) {
  const items = step?.items ?? [];
  if (step?.kind !== "transaction" || items.length !== 1 || !items[0]?.data)
    throw fail("each step must be one transaction");
  const tx = items[0].data;
  if (tx.chainId !== request.from.chainId) throw fail("its transaction is on another chain");
  if (tx.from !== undefined && !same(tx.from, request.from.owner))
    throw fail("its transaction is from another account");
  if (tx.value !== undefined && tx.value !== "0") throw fail("its transaction sends value");
  return tx;
}

function stepRequestId(step: Step) {
  if (typeof step?.requestId !== "string" || !step.requestId) throw fail("it has no request ID");
  return step.requestId;
}

/** At least the quoted input, at most that plus slippage. */
function checkAmount(
  amount: bigint,
  quote: RelayProtocolRoute.ApiQuote,
  request: CrossChain.Request,
  what: string,
) {
  const quotedIn = BigInt(quote.details.currencyIn.amount);
  const bound = (quotedIn * BigInt(10_000 + request.maxSlippageBps) + 9_999n) / 10_000n;
  if (amount < quotedIn || amount > bound) throw fail(`${what} is outside the quoted input`);
}

function protocolOrderId(quote: RelayProtocolRoute.ApiQuote) {
  const protocol = quote.protocol as { v2?: { orderId?: unknown } } | undefined;
  const orderId = protocol?.v2?.orderId;
  return typeof orderId === "string" && /^0x[\da-fA-F]{64}$/.test(orderId) ? orderId : undefined;
}

/** The arguments of exactly `functionName` ERC-20 calldata with `count` static words, or none. */
function decodeExact(data: unknown, functionName: "transfer" | "approve", count: number) {
  const selector = functionName === "transfer" ? "0xa9059cbb" : "0x095ea7b3";
  if (typeof data !== "string" || !data.startsWith(selector) || data.length !== 2 + 8 + 64 * count)
    return undefined;
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: data as Hex });
    return decoded.functionName === functionName ? decoded.args : undefined;
  } catch {
    return undefined;
  }
}

/** The arguments of exactly `depositErc20(address,address,uint256,bytes32)` calldata, or none. */
function decodeDeposit(data: unknown) {
  if (typeof data !== "string" || !data.startsWith("0xe8017952") || data.length !== 2 + 8 + 256)
    return undefined;
  try {
    const decoded = decodeFunctionData({ abi: relayDepositoryAbi, data: data as Hex });
    return decoded.args as readonly [string, string, bigint, string];
  } catch {
    return undefined;
  }
}

function same(value: unknown, expected: string) {
  return typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
}
