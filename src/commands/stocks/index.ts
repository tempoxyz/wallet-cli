import { Cli } from "incur";

import type { WalletCommand } from "../../cli/command.js";
import { cliGlobals } from "../../schemas/shared.js";
import { buyAnnotations, buyCommand } from "./buy.js";
import { cancelAnnotations, cancelCommand } from "./cancel.js";
import { listAnnotations, listCommand } from "./list.js";
import { ordersAnnotations, ordersCommand } from "./orders.js";
import { portfolioAnnotations, portfolioCommand } from "./portfolio.js";
import { quoteAnnotations, quoteCommand } from "./quote.js";
import { sellAnnotations, sellCommand } from "./sell.js";

// Mounted groups share the root globals; declaring them types `globals` in their commands.
export default {
  command: Cli.create("stocks", {
    description: "Trade tokenized US stocks (Dinari dShares) on Tempo Stocks",
    globals: cliGlobals,
  })
    .command("list", listCommand)
    .command("quote", quoteCommand)
    .command("portfolio", portfolioCommand)
    .command("orders", ordersCommand)
    .command("buy", buyCommand)
    .command("sell", sellCommand)
    .command("cancel", cancelCommand),
  annotations: {
    stocks_list: listAnnotations,
    stocks_quote: quoteAnnotations,
    stocks_portfolio: portfolioAnnotations,
    stocks_orders: ordersAnnotations,
    stocks_buy: buyAnnotations,
    stocks_sell: sellAnnotations,
    stocks_cancel: cancelAnnotations,
  },
} satisfies WalletCommand;
