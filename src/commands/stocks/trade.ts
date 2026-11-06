import { usageError, walletError } from "../../shared/errors.js";
import { networkFields } from "../../shared/network.js";
import { nextStep } from "../../shared/next.js";
import { confirm } from "../../shared/process.js";
import type { Wallet } from "../../shared/require-wallet.js";
import { getRecord, sanitizeText, stringValue } from "../../shared/utils.js";
import {
  connectStocks,
  decimalText,
  requireOnboarded,
  resolveStock,
  type StocksDependencies,
} from "./api.js";
import { readHours, readQuote } from "./quote.js";

export type TradeDependencies = StocksDependencies & {
  confirm: (question: string) => Promise<boolean>;
};

export type TradeInput = {
  side: "BUY" | "SELL";
  amount: string;
  symbol: string;
  options: {
    shares?: boolean | undefined;
    "limit-price"?: string | undefined;
    "dry-run"?: boolean | undefined;
    yes?: boolean | undefined;
    browser?: boolean | undefined;
    wait?: boolean | undefined;
  };
  /** Whether a person can answer the confirmation prompt; see `canPrompt`. */
  interactive: boolean;
};

/** How often to ask whether the order was approved, and for how long. */
export const approvalPollIntervalMs = 2_000;
export const approvalWaitMs = 10 * 60_000;

const failedStatuses = new Set(["ERROR", "CANCELLED", "EXPIRED", "REJECTED"]);

/**
 * Places a stock order through Tempo Stocks. The access key signs in, but cannot sign the Dinari
 * permit: the account approves it with its passkey in the browser at the approval link. Without
 * `wait` false, this then waits until the order is submitted, or fails when it is rejected.
 */
export async function placeOrder(
  wallet: Wallet,
  input: TradeInput,
  dependencies: Partial<TradeDependencies> = {},
) {
  const { side, options } = input;
  const network = wallet.network;
  const limitPrice = options["limit-price"];
  const type = limitPrice === undefined ? ("MARKET" as const) : ("LIMIT" as const);
  if (side === "SELL" && options.shares) throw usageError("--shares applies to buy orders");
  const unit =
    side === "BUY" && type === "MARKET" && !options.shares ? ("usd" as const) : ("shares" as const);
  const amount = parseDecimal(
    input.amount,
    unit === "usd" ? 2 : type === "LIMIT" ? 4 : 6,
    unit === "usd" ? "USD amount" : "share amount",
  );
  if (limitPrice !== undefined) parseDecimal(limitPrice, 2, "--limit-price");

  const runtime = { confirm, ...dependencies };
  const client = await connectStocks(wallet, runtime);
  const stock = await resolveStock(client, input.symbol, { tradable: true });
  if (unit === "shares" && !stock.is_fractionable && amount % 10n ** 6n !== 0n)
    throw usageError(`${stock.symbol} trades in whole shares only`);

  const base = {
    ...networkFields(network.chainId),
    symbol: stock.symbol,
    stock_id: stock.id,
    side,
    type,
    amount: input.amount,
    amount_unit: unit,
    limit_price: limitPrice ?? null,
  };
  const verb = side === "BUY" ? "buy" : "sell";
  const flags = [
    ...(options.shares ? ["--shares"] : []),
    ...(limitPrice !== undefined ? ["--limit-price", limitPrice] : []),
    ...(options.browser === false ? ["--no-browser"] : []),
    ...(options.wait === false ? ["--no-wait"] : []),
  ];

  if (options["dry-run"]) {
    const [quote, hours] = await Promise.all([readQuote(client, stock.id), readHours(client)]);
    const quoted = side === "BUY" ? (quote.ask ?? quote.price) : (quote.bid ?? quote.price);
    const price = limitPrice ?? quoted;
    const estimate = estimateOrder({ unit, amount, price, feeBps: client.feeBps });
    return {
      status: "dry_run" as const,
      ...base,
      price: quoted,
      market_open: hours.market_open,
      ...estimate,
      fee_bps: client.feeBps,
      ...nextStep(
        "Review the estimate, then run the next command to create the order. You approve it with your passkey in the browser.",
        ["wallet", "stocks", verb, input.amount, stock.symbol, ...flags, "--yes"],
        { network },
      ),
    };
  }

  await requireOnboarded(client, options.browser === false);
  if (!options.yes) {
    if (!input.interactive)
      throw usageError("Order not created: review it with --dry-run, then pass --yes");
    const confirmed = await runtime.confirm(
      [
        `${side === "BUY" ? "Buy" : "Sell"} ${describeAmount(unit, input.amount)} ${stock.symbol} ${type === "LIMIT" ? `at a limit of $${limitPrice} per share` : "at market"}`,
        `  network: ${network.name} (chain ${network.chainId})`,
        "You approve it with your passkey in the browser next.",
        "Create this order?",
      ].join("\n"),
    );
    if (!confirmed) throw usageError("Order not created: not confirmed at the prompt");
  }

  const permit = getRecord(
    await client.post("/api/orders/permit", {
      stockId: stock.id,
      side,
      type,
      amount: input.amount,
      ...(limitPrice !== undefined ? { limitPrice } : {}),
    }),
  );
  const requestId = sanitizeText(stringValue(permit.orderRequestId));
  const approvalUrl = stringValue(permit.approvalUrl);
  if (!requestId || !URL.canParse(approvalUrl) || !/^https?:$/.test(new URL(approvalUrl).protocol))
    throw walletError({
      code: "E_HTTP",
      message: "Tempo Stocks returned no order request or approval link",
    });
  const fee = decimalText(permit.fee);
  console.error(`Approve this order with your passkey: ${approvalUrl}`);
  if (options.browser !== false) client.dependencies.open(approvalUrl);

  const ordersNext = (instruction: string) =>
    nextStep(instruction, ["wallet", "stocks", "orders"], { network });
  if (options.wait === false)
    return {
      status: "pending_approval" as const,
      ...base,
      order_request_id: requestId,
      fee,
      approval_url: approvalUrl,
      ...ordersNext(
        "Approve the order with your passkey at approval_url within 15 minutes, then check it with the next command.",
      ),
    };

  const deadline = client.dependencies.now() + approvalWaitMs;
  for (;;) {
    const status = await requestStatus(client, requestId);
    if (status?.status === "SUBMITTED" && status.orderId)
      return {
        status: "submitted" as const,
        ...base,
        order_request_id: requestId,
        order_id: status.orderId,
        fee,
        ...ordersNext("Track the order with the next command."),
      };
    if (status && failedStatuses.has(status.status))
      throw walletError({
        code: "E_ORDER_REJECTED",
        message: `Order ${status.status.toLowerCase()}${status.message ? `: ${status.message}` : ""}`,
      });
    if (client.dependencies.now() >= deadline)
      throw walletError({
        code: "E_POLL_TIMEOUT",
        // Running the command again would create another order.
        retryable: false,
        message: `Order not approved after ${approvalWaitMs / 60_000} minutes. Approve it at ${approvalUrl} before it expires, then check it with 'tempo wallet stocks orders'.`,
      });
    await client.dependencies.sleep(approvalPollIntervalMs);
  }
}

/** The order request's status, or `undefined` when it could not be read this time. */
async function requestStatus(client: Awaited<ReturnType<typeof connectStocks>>, requestId: string) {
  let body: unknown;
  try {
    body = await client.get(`/api/orders/requests/${encodeURIComponent(requestId)}`);
  } catch (error) {
    // A dropped connection must not end the wait while the person is approving.
    if (getRecord(error).code === "E_NETWORK") return undefined;
    throw error;
  }
  const record = getRecord(body);
  return {
    status: sanitizeText(stringValue(record.status)).toUpperCase(),
    orderId: sanitizeText(stringValue(record.orderId)),
    message: sanitizeText(stringValue(record.message)),
  };
}

function describeAmount(unit: "usd" | "shares", amount: string) {
  return unit === "usd" ? `$${amount} of` : `${amount} ${amount === "1" ? "share" : "shares"} of`;
}

const scale = 10n ** 6n;

/** `value` in millionths, refusing more than `decimals` decimals or a value that is not positive. */
function parseDecimal(value: string, decimals: number, label: string) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > decimals)
    throw usageError(
      `Invalid ${label}: expected a positive number with at most ${decimals} decimals`,
    );
  const micros = BigInt(match[1]!) * scale + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (micros <= 0n) throw usageError(`Invalid ${label}: must be greater than zero`);
  return micros;
}

/** `text` in millionths, truncating past six decimals; `null` when it is not a decimal. */
function micros(text: string | null) {
  const match = text === null ? null : /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  return BigInt(match[1]!) * scale + BigInt((match[2] ?? "").slice(0, 6).padEnd(6, "0"));
}

function usdText(value: bigint) {
  const cents = (value + 5_000n) / 10_000n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function sharesText(value: bigint) {
  const fraction = String(value % scale)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${value / scale}.${fraction}` : String(value / scale);
}

/** The shares and USD value an order comes to at `price`, and the Tempo Stocks fee on it. */
export function estimateOrder(options: {
  unit: "usd" | "shares";
  amount: bigint;
  price: string | null;
  feeBps: number;
}) {
  const price = micros(options.price);
  if (price === null || price === 0n)
    return { estimated_shares: null, estimated_value: null, estimated_fee: null };
  const shares = options.unit === "usd" ? (options.amount * scale) / price : options.amount;
  const value = options.unit === "usd" ? options.amount : (options.amount * price) / scale;
  const fee = (value * BigInt(Math.max(0, Math.round(options.feeBps)))) / 10_000n;
  return {
    estimated_shares: sharesText(shares),
    estimated_value: usdText(value),
    estimated_fee: usdText(fee),
  };
}
