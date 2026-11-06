import type { z } from "incur";

import { readOnly } from "../../cli/command.js";
import { stocksAccountOptions, stocksOrdersOutput } from "../../schemas/stocks.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import type { CommandContext } from "../../shared/errors.js";
import { networkFields } from "../../shared/network.js";
import { withWallet, type Wallet } from "../../shared/require-wallet.js";
import { getArray, getRecord, sanitizeText, stringValue } from "../../shared/utils.js";
import { connectStocks, decimalText, requireOnboarded, type StocksDependencies } from "./api.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type OrdersContext = CommandContext & {
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof stocksAccountOptions>;
};

export const ordersCommand = {
  description: "List stock orders on Tempo Stocks",
  options: stocksAccountOptions,
  alias: globalAlias,
  output: stocksOrdersOutput,
  run: withWallet((context: OrdersContext, wallet) =>
    ordersHandler(wallet, { noBrowser: context.options.browser === false }),
  ),
};

export const ordersAnnotations = { ...readOnly, openWorldHint: true };

export async function ordersHandler(
  wallet: Wallet,
  options: { noBrowser?: boolean | undefined } = {},
  dependencies: Partial<StocksDependencies> = {},
) {
  const client = await connectStocks(wallet, dependencies);
  await requireOnboarded(client, options.noBrowser);
  const body = getRecord(await client.get("/api/orders"));
  return {
    ...networkFields(wallet.network.chainId),
    orders: getArray(body.orders).map((value) => {
      const order = getRecord(value);
      const text = (field: unknown) => sanitizeText(stringValue(field));
      return {
        id: text(order.id),
        stock_id: text(order.stockId),
        side: text(order.side),
        type: text(order.type),
        status: text(order.status),
        created_at: text(order.createdAt) || null,
        asset_quantity: decimalText(order.assetQuantity),
        payment_quantity: decimalText(order.paymentQuantity),
        fee: decimalText(order.fee),
        limit_price: decimalText(order.limitPrice),
        transaction_hash: text(order.transactionHash) || null,
      };
    }),
  };
}
