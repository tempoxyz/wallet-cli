/**
 * [MF-2] A ready-made Relay route: machine-fetch's `relayProtocol()` fetches and parses a quote,
 * and every integrator must still write `guarantees`, `submit`, and `status`, the security-critical
 * part. This is that part for Relay's single-use deposit addresses, where the source-side step is
 * one ERC-20/TIP-20 `transfer` of the source token to the deposit address. The application only
 * supplies the signer that sends that transfer. Proven here by the CLI's hostile-quote tests, then
 * lifted into machine-fetch.
 */
import { FundingError } from "machine-fetch";
import type {
  BoundedCrossChainQuote,
  CrossChainRequest,
  CrossChainRoute,
} from "machine-fetch/interfaces/evm";
import { type RelayApiQuote, relayProtocol } from "machine-fetch/routes/relay-protocol";
import { type Address, decodeFunctionData, erc20Abi, type Hex } from "viem";

/** A deposit step's validated transfer: the only funds-moving action a quote may ask for. */
export type RelayDeposit = {
  /** Relay's request ID, used for status and recovery. */
  requestId: string;
  token: Address;
  depositAddress: Address;
  amount: bigint;
};

/** Refused because the funding would exceed the application's source-side ceiling. */
export class RelayFundingLimitError extends FundingError {
  override readonly name = "RelayFundingLimitError";
  /** The source debit the quote needs, gas included, in atomic units. */
  readonly required: bigint;

  constructor(required: bigint, limit: bigint) {
    super(
      `Relay funding needs ${required} atomic units of the source token, above the ${limit} allowed`,
    );
    this.required = required;
  }
}

export type RelayDepositRouteOptions = {
  /** Route name. @default relay */
  name?: string;
  /** Relay API base URL. @default https://api.relay.link */
  url?: string;
  fetch?: typeof globalThis.fetch;
  /** Most the source-side transfer's gas may cost, in atomic units of the source token. */
  maxGas: bigint;
  /** Ceiling on the source debit, transfer plus gas; checked before anything is signed. */
  maxSpend?: bigint | undefined;
  /** Validity of a quote that carries no `expiresAt`, in seconds. @default 60 */
  quoteTtlSeconds?: number;
  /** Sign and broadcast exactly this transfer on the source chain; resolve once it is accepted. */
  transfer(deposit: RelayDeposit, request: CrossChainRequest): Promise<void>;
  /** Observes progress without affecting it, for example to print it. */
  onProgress?(
    event:
      | { type: "submitted"; deposit: RelayDeposit; request: CrossChainRequest }
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

/** A bounded Relay route through single-use deposit addresses, with every quote validated. */
export function relayDepositRoute(
  options: RelayDepositRouteOptions,
): CrossChainRoute<BoundedCrossChainQuote> {
  const url = (options.url ?? "https://api.relay.link").replace(/\/$/, "");
  const fetchJson = options.fetch ?? globalThis.fetch;
  const ttl = options.quoteTtlSeconds ?? 60;
  return relayProtocol({
    name: options.name ?? "relay",
    url,
    fetch: fetchJson,
    useDepositAddress: true,
    guarantees({ quote, request }) {
      const deposit = relayDeposit(quote, request);
      const required = deposit.amount + options.maxGas;
      if (options.maxSpend !== undefined && required > options.maxSpend)
        throw new RelayFundingLimitError(required, options.maxSpend);
      const now = Math.floor(Date.now() / 1000);
      const quoted = quote.expiresAt;
      if (quoted !== undefined && (!Number.isSafeInteger(quoted) || (quoted as number) <= now))
        throw new FundingError("Relay quote is expired");
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
      const deposit = relayDeposit(quote, request);
      if (deposit.amount > limits.maxAmountIn)
        throw new FundingError("Relay deposit exceeds its maximum input");
      await options.transfer(deposit, request);
      options.onProgress?.({ type: "submitted", deposit, request });
      return { reference: deposit.requestId };
    },
    async status(operation, { signal }) {
      const requestId = operation.reference ?? operation.quote.reference;
      const response = await fetchJson(
        `${url}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`,
        { signal },
      );
      if (response.status === 404) return { status: "pending" };
      if (!response.ok)
        throw new FundingError(`Relay status request failed with HTTP ${response.status}`);
      const body = (await response.json().catch(() => ({}))) as { status?: unknown };
      const status = typeof body.status === "string" ? relayStatuses[body.status] : undefined;
      if (!status) throw new FundingError("Relay status response is malformed");
      if (status === "pending") options.onProgress?.({ type: "pending", requestId });
      return { status };
    },
  });
}

/**
 * The single transfer a quote's steps may ask for, or a FundingError: exactly one transaction step
 * with one item, on the source chain, from the source account, calling the source token's
 * `transfer` with no value or extra data, to the step's deposit address, for at least the quoted
 * input and at most that plus slippage. Relay must deliver exactly the requested output of the
 * destination token to the destination account.
 */
export function relayDeposit(quote: RelayApiQuote, request: CrossChainRequest): RelayDeposit {
  const fail = (message: string) => new FundingError(`Relay quote rejected: ${message}`);
  const { details, steps } = quote;
  if (
    details.currencyOut.currency.chainId !== request.to.chainId ||
    !same(details.currencyOut.currency.address, request.to.asset) ||
    !same(details.recipient, request.to.account) ||
    details.currencyOut.amount !== request.amountOut.toString()
  )
    throw fail("it does not deliver the requested output to the destination account");
  if (steps.length !== 1) throw fail("it must have exactly one step");
  const [step] = steps;
  const items = step?.items ?? [];
  if (step?.kind !== "transaction" || items.length !== 1 || !items[0]?.data)
    throw fail("its step must be one transaction");
  const tx = items[0].data;
  if (tx.chainId !== request.from.chainId) throw fail("its transaction is on another chain");
  if (!same(tx.to, request.from.asset))
    throw fail("its transaction calls a contract other than the source token");
  if (tx.from !== undefined && !same(tx.from, request.from.account))
    throw fail("its transaction is from another account");
  if (tx.value !== undefined && tx.value !== "0") throw fail("its transaction sends value");
  if (typeof step.requestId !== "string" || !step.requestId) throw fail("it has no request ID");
  const depositAddress = step.depositAddress;
  if (typeof depositAddress !== "string" || !/^0x[\da-fA-F]{40}$/.test(depositAddress))
    throw fail("it has no deposit address");
  const transfer = decodeTransfer(tx.data);
  if (!transfer) throw fail("its transaction is not a token transfer");
  const [recipient, amount] = transfer;
  if (!same(recipient, depositAddress)) throw fail("its transfer is not to the deposit address");
  const quotedIn = BigInt(details.currencyIn.amount);
  const bound = (quotedIn * BigInt(10_000 + request.maxSlippageBps) + 9_999n) / 10_000n;
  if (amount < quotedIn || amount > bound)
    throw fail("its transfer amount is outside the quoted input");
  return {
    requestId: step.requestId,
    token: request.from.asset,
    depositAddress: depositAddress as Address,
    amount,
  };
}

/** The recipient and amount of exactly `transfer(address,uint256)` calldata, else `undefined`. */
function decodeTransfer(data: unknown): readonly [string, bigint] | undefined {
  if (typeof data !== "string" || !data.startsWith("0xa9059cbb") || data.length !== 2 + 8 + 128)
    return undefined;
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: data as Hex });
    return decoded.functionName === "transfer" ? (decoded.args as [string, bigint]) : undefined;
  } catch {
    return undefined;
  }
}

function same(value: unknown, expected: string) {
  return typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
}
