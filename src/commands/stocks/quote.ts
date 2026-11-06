import type { z } from "incur";

import { readOnly } from "../../cli/command.js";
import { stocksQuoteArgs, stocksQuoteOutput, stocksReadOptions } from "../../schemas/stocks.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import type { CommandContext } from "../../shared/errors.js";
import { networkFields } from "../../shared/network.js";
import { withWallet, type Wallet } from "../../shared/require-wallet.js";
import { getRecord, sanitizeText, stringValue } from "../../shared/utils.js";
import {
  connectStocks,
  decimalText,
  resolveStock,
  type StocksClient,
  type StocksDependencies,
} from "./api.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type QuoteContext = CommandContext & {
  args: z.output<typeof stocksQuoteArgs>;
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof stocksReadOptions>;
};

export const quoteCommand = {
  description: "Show a stock's quote and whether the market is open",
  args: stocksQuoteArgs,
  options: stocksReadOptions,
  alias: globalAlias,
  output: stocksQuoteOutput,
  examples: [{ args: { symbol: "AAPL" } }],
  run: withWallet((context: QuoteContext, wallet) => quoteHandler(wallet, context.args.symbol)),
};

export const quoteAnnotations = { ...readOnly, openWorldHint: true };

export async function quoteHandler(
  wallet: Wallet,
  symbol: string,
  dependencies: Partial<StocksDependencies> = {},
) {
  const client = await connectStocks(wallet, dependencies);
  const stock = await resolveStock(client, symbol);
  const [quote, hours] = await Promise.all([readQuote(client, stock.id), readHours(client)]);
  return {
    ...networkFields(wallet.network.chainId),
    symbol: stock.symbol,
    name: stock.name,
    stock_id: stock.id,
    ...quote,
    ...hours,
  };
}

export async function readQuote(client: StocksClient, stockId: string) {
  const quote = getRecord(
    await client.get(`/api/market/stocks/${encodeURIComponent(stockId)}/quote`),
  );
  return {
    price: decimalText(quote.price),
    bid: decimalText(quote.bid),
    ask: decimalText(quote.ask),
    change: decimalText(quote.change),
    change_percent: decimalText(quote.changePercent),
    timestamp: timeText(quote.timestamp),
  };
}

export async function readHours(client: StocksClient) {
  const hours = getRecord(await client.get("/api/market/hours"));
  return {
    market_open: typeof hours.isOpen === "boolean" ? hours.isOpen : null,
    next_open: timeText(hours.nextOpen),
    next_close: timeText(hours.nextClose),
  };
}

function timeText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value))
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  return sanitizeText(stringValue(value)) || null;
}
