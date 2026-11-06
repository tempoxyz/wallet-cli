import { z } from "incur";

import { displayMeta } from "../cli/render.js";
import {
  browserOption,
  describeMeta,
  globalOptionShape,
  networkOutputShape,
  nextOutputShape,
} from "./shared.js";

const symbolArg = z.string().describe("Stock ticker symbol, e.g. AAPL");

/** `--no-wait` on buy and sell: return once the approval link is open. */
const waitOption = z
  .boolean()
  .default(true)
  .describe("Wait until the order is submitted; use --no-wait to return once approval is open")
  .register(describeMeta, { negated: "Return once the approval link is open, without waiting" });

const limitPriceOption = z
  .string()
  .optional()
  .describe("Place a limit order at this price per share in USD")
  .register(describeMeta, { valueName: "USD" });

export const stocksListArgs = z.object({
  symbols: z
    .array(z.string())
    .optional()
    .describe("Ticker symbols to show; every stock when omitted"),
});

export const stocksQuoteArgs = z.object({ symbol: symbolArg });

export const stocksBuyArgs = z.object({
  amount: z
    .string()
    .describe("USD to spend on a market buy; shares with --shares or --limit-price"),
  symbol: symbolArg,
});

export const stocksSellArgs = z.object({
  shares: z.string().describe("Number of shares to sell"),
  symbol: symbolArg,
});

export const stocksCancelArgs = z.object({
  "order-id": z.string().describe("Order ID, as 'tempo wallet stocks orders' lists it"),
});

export const stocksReadOptions = z.object({ ...globalOptionShape });

export const stocksAccountOptions = z.object({ ...globalOptionShape, browser: browserOption });

const tradeOptionShape = {
  ...globalOptionShape,
  "limit-price": limitPriceOption,
  "dry-run": z
    .boolean()
    .optional()
    .describe("Show the quote and estimated cost and fee without creating an order"),
  yes: z
    .boolean()
    .optional()
    .describe("Create the order without the confirmation prompt; required for agent runs"),
  browser: browserOption,
  wait: waitOption,
};

export const stocksBuyOptions = z.object({
  ...tradeOptionShape,
  shares: z.boolean().optional().describe("Treat the amount as shares instead of USD"),
});

export const stocksSellOptions = z.object(tradeOptionShape);

export const stocksCancelOptions = z.object({
  ...globalOptionShape,
  yes: z
    .boolean()
    .optional()
    .describe("Cancel without the confirmation prompt; required for agent runs"),
});

const stockOutput = z.object({
  symbol: z.string(),
  name: z.string(),
  id: z.string().register(displayMeta, { hidden: true }),
  logo_url: z.string().register(displayMeta, { hidden: true }).nullable(),
  is_fractionable: z.boolean(),
  is_tradable: z.boolean(),
});

export const stocksListOutput = z.object({
  ...networkOutputShape,
  stocks: z.array(stockOutput),
});

const usd = z.string().nullable();

export const stocksQuoteOutput = z.object({
  ...networkOutputShape,
  symbol: z.string(),
  name: z.string(),
  stock_id: z.string().register(displayMeta, { hidden: true }),
  price: usd.describe("Last price in USD"),
  bid: usd,
  ask: usd,
  change: usd,
  change_percent: usd,
  timestamp: z.string().nullable(),
  market_open: z.boolean().nullable(),
  next_open: z.string().nullable(),
  next_close: z.string().nullable(),
});

const positionOutput = z.object({
  symbol: z.string(),
  amount: z.string(),
  token_address: z.string().register(displayMeta, { address: true }),
  chain_id: z.number().nullable(),
});

export const stocksPortfolioOutput = z.object({
  ...networkOutputShape,
  address: z.string(),
  holdings: z.array(
    positionOutput.extend({ stock_id: z.string().register(displayMeta, { hidden: true }) }),
  ),
  cash: z.array(positionOutput),
});

const orderOutput = z.object({
  id: z.string(),
  stock_id: z.string().register(displayMeta, { hidden: true }),
  side: z.string(),
  type: z.string(),
  status: z.string(),
  created_at: z.string().nullable(),
  asset_quantity: z.string().nullable().describe("Shares"),
  payment_quantity: z.string().nullable().describe("USD"),
  fee: z.string().nullable(),
  limit_price: z.string().nullable(),
  transaction_hash: z.string().register(displayMeta, { address: true }).nullable(),
});

export const stocksOrdersOutput = z.object({
  ...networkOutputShape,
  orders: z.array(orderOutput),
});

const tradeOutputShape = {
  ...networkOutputShape,
  symbol: z.string(),
  stock_id: z.string().register(displayMeta, { hidden: true }),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]),
  amount: z.string().describe("The order amount, in amount_unit"),
  amount_unit: z.enum(["usd", "shares"]),
  limit_price: z.string().nullable(),
};

export const stocksTradeDryRunOutput = z.object({
  status: z.literal("dry_run"),
  ...tradeOutputShape,
  price: usd.describe("The quote's ask for a buy, bid for a sell"),
  market_open: z.boolean().nullable(),
  estimated_shares: usd,
  estimated_value: usd.describe("Estimated USD cost of a buy or proceeds of a sell, before fees"),
  estimated_fee: usd.describe("Estimated Tempo Stocks fee in USD; Dinari may charge more"),
  fee_bps: z.number(),
  ...nextOutputShape,
});

export const stocksTradePendingOutput = z.object({
  status: z.literal("pending_approval"),
  ...tradeOutputShape,
  order_request_id: z.string(),
  fee: z.string().nullable(),
  approval_url: z.string(),
  ...nextOutputShape,
});

export const stocksTradeSubmittedOutput = z.object({
  status: z.literal("submitted").register(displayMeta, { tone: { submitted: "ok" } }),
  ...tradeOutputShape,
  order_request_id: z.string(),
  order_id: z.string(),
  fee: z.string().nullable(),
  ...nextOutputShape,
});

export const stocksTradeOutput = z.union([
  stocksTradeDryRunOutput,
  stocksTradePendingOutput,
  stocksTradeSubmittedOutput,
]);

export const stocksCancelOutput = z.object({
  status: z.literal("cancel_requested"),
  ...networkOutputShape,
  order_id: z.string(),
  ...nextOutputShape,
});
