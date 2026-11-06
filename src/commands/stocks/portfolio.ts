import type { z } from "incur";

import { readOnly } from "../../cli/command.js";
import { stocksAccountOptions, stocksPortfolioOutput } from "../../schemas/stocks.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import type { CommandContext } from "../../shared/errors.js";
import { networkFields } from "../../shared/network.js";
import { withWallet, type Wallet } from "../../shared/require-wallet.js";
import { getArray, getRecord, sanitizeText, stringValue } from "../../shared/utils.js";
import { connectStocks, decimalText, requireOnboarded, type StocksDependencies } from "./api.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type PortfolioContext = CommandContext & {
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof stocksAccountOptions>;
};

export const portfolioCommand = {
  description: "Show stock holdings and cash on Tempo Stocks",
  options: stocksAccountOptions,
  alias: globalAlias,
  output: stocksPortfolioOutput,
  run: withWallet((context: PortfolioContext, wallet) =>
    portfolioHandler(wallet, { noBrowser: context.options.browser === false }),
  ),
};

export const portfolioAnnotations = { ...readOnly, openWorldHint: true };

export async function portfolioHandler(
  wallet: Wallet,
  options: { noBrowser?: boolean | undefined } = {},
  dependencies: Partial<StocksDependencies> = {},
) {
  const client = await connectStocks(wallet, dependencies);
  await requireOnboarded(client, options.noBrowser);
  const portfolio = getRecord(await client.get("/api/portfolio"));
  return {
    ...networkFields(wallet.network.chainId),
    address: client.address,
    holdings: getArray(portfolio.holdings).map((value) => ({
      ...position(value),
      stock_id: sanitizeText(stringValue(getRecord(value).stockId)),
    })),
    cash: getArray(portfolio.cash).map(position),
  };
}

function position(value: unknown) {
  const item = getRecord(value);
  return {
    symbol: sanitizeText(stringValue(item.symbol)),
    amount: decimalText(item.amount) ?? "0",
    token_address: sanitizeText(stringValue(item.tokenAddress)).toLowerCase(),
    chain_id: typeof item.chainId === "number" ? item.chainId : null,
  };
}
