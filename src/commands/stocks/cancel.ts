import type { z } from "incur";

import { destructive } from "../../cli/command.js";
import { stocksCancelArgs, stocksCancelOptions, stocksCancelOutput } from "../../schemas/stocks.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import { usageError, type CommandContext } from "../../shared/errors.js";
import { networkFields } from "../../shared/network.js";
import { nextStep } from "../../shared/next.js";
import { canPrompt, confirm } from "../../shared/process.js";
import { withWallet, type Wallet } from "../../shared/require-wallet.js";
import { connectStocks, type StocksDependencies } from "./api.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type CancelContext = CommandContext & {
  args: z.output<typeof stocksCancelArgs>;
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof stocksCancelOptions>;
};

export const cancelCommand = {
  description: "Cancel an open stock order",
  args: stocksCancelArgs,
  options: stocksCancelOptions,
  alias: globalAlias,
  output: stocksCancelOutput,
  run: withWallet((context: CancelContext, wallet) =>
    cancelHandler(wallet, {
      orderId: context.args["order-id"],
      yes: context.options.yes,
      interactive: canPrompt(context.agent),
    }),
  ),
};

// Cancelling an order twice leaves it cancelled.
export const cancelAnnotations = { ...destructive, idempotentHint: true, openWorldHint: true };

export async function cancelHandler(
  wallet: Wallet,
  input: { orderId: string; yes?: boolean | undefined; interactive: boolean },
  dependencies: Partial<
    StocksDependencies & { confirm: (question: string) => Promise<boolean> }
  > = {},
) {
  const orderId = input.orderId.trim();
  if (!/^[\w-]{1,128}$/.test(orderId)) throw usageError("Invalid order ID");
  if (!input.yes) {
    if (!input.interactive) throw usageError("Order not cancelled: pass --yes to cancel it");
    const confirmed = await (dependencies.confirm ?? confirm)(`Cancel stock order ${orderId}?`);
    if (!confirmed) throw usageError("Order not cancelled: not confirmed at the prompt");
  }
  const client = await connectStocks(wallet, dependencies);
  await client.post(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {});
  return {
    status: "cancel_requested" as const,
    ...networkFields(wallet.network.chainId),
    order_id: orderId,
    ...nextStep("Check the order's status with the next command.", ["wallet", "stocks", "orders"], {
      network: wallet.network,
    }),
  };
}
