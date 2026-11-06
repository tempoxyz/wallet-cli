import type { z } from "incur";

import { destructive } from "../../cli/command.js";
import { stocksBuyArgs, stocksBuyOptions, stocksTradeOutput } from "../../schemas/stocks.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import type { CommandContext } from "../../shared/errors.js";
import { canPrompt } from "../../shared/process.js";
import { withWallet } from "../../shared/require-wallet.js";
import { placeOrder } from "./trade.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type BuyContext = CommandContext & {
  args: z.output<typeof stocksBuyArgs>;
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof stocksBuyOptions>;
};

export const buyCommand = {
  description: "Buy a stock: USD to spend at market, or shares with --shares or --limit-price",
  args: stocksBuyArgs,
  options: stocksBuyOptions,
  alias: globalAlias,
  output: stocksTradeOutput,
  examples: [
    { args: { amount: "100", symbol: "AAPL" }, options: { "dry-run": true } },
    { args: { amount: "2", symbol: "NVDA" }, options: { "limit-price": "120", yes: true } },
  ],
  run: withWallet((context: BuyContext, wallet) =>
    placeOrder(wallet, {
      side: "BUY",
      amount: context.args.amount,
      symbol: context.args.symbol,
      options: context.options,
      interactive: canPrompt(context.agent),
    }),
  ),
};

export const buyAnnotations = { ...destructive, idempotentHint: false, openWorldHint: true };
