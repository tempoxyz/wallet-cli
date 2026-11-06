import type { z } from "incur";

import { readOnly } from "../../cli/command.js";
import { stocksListArgs, stocksListOutput, stocksReadOptions } from "../../schemas/stocks.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import type { CommandContext } from "../../shared/errors.js";
import { networkFields } from "../../shared/network.js";
import { withWallet, type Wallet } from "../../shared/require-wallet.js";
import { connectStocks, listStocks, type StocksDependencies } from "./api.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type ListContext = CommandContext & {
  args: z.output<typeof stocksListArgs>;
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof stocksReadOptions>;
};

export const listCommand = {
  description: "List tokenized US stocks on Tempo Stocks",
  args: stocksListArgs,
  options: stocksReadOptions,
  alias: globalAlias,
  output: stocksListOutput,
  examples: [{ args: { symbols: ["AAPL"] } }],
  run: withWallet((context: ListContext, wallet) => listHandler(wallet, context.args.symbols)),
};

export const listAnnotations = { ...readOnly, openWorldHint: true };

export async function listHandler(
  wallet: Wallet,
  symbols: readonly string[] = [],
  dependencies: Partial<StocksDependencies> = {},
) {
  const client = await connectStocks(wallet, dependencies);
  return {
    ...networkFields(wallet.network.chainId),
    stocks: await listStocks(client, symbols),
  };
}
