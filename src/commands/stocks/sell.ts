import type { z } from "incur";

import { destructive } from "../../cli/command.js";
import { stocksSellArgs, stocksSellOptions, stocksTradeOutput } from "../../schemas/stocks.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import type { CommandContext } from "../../shared/errors.js";
import { canPrompt } from "../../shared/process.js";
import { withWallet } from "../../shared/require-wallet.js";
import { placeOrder } from "./trade.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type SellContext = CommandContext & {
  args: z.output<typeof stocksSellArgs>;
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof stocksSellOptions>;
};

export const sellCommand = {
  description: "Sell shares of a stock at market, or at --limit-price",
  args: stocksSellArgs,
  options: stocksSellOptions,
  alias: globalAlias,
  output: stocksTradeOutput,
  examples: [{ args: { shares: "1.5", symbol: "AAPL" }, options: { "dry-run": true } }],
  run: withWallet((context: SellContext, wallet) =>
    placeOrder(wallet, {
      side: "SELL",
      amount: context.args.shares,
      symbol: context.args.symbol,
      options: context.options,
      interactive: canPrompt(context.agent),
    }),
  ),
};

export const sellAnnotations = { ...destructive, idempotentHint: false, openWorldHint: true };
