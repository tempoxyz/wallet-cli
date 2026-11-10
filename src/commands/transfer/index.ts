import { Cli } from "incur";

import { destructive, type WalletCommand } from "../../cli/command.js";
import { cliGlobals, globalAlias } from "../../schemas/shared.js";
import { transferOptions, transferOutput } from "../../schemas/transfer.js";
import { withWallet } from "../../shared/require-wallet.js";
import { transferMach } from "./mach.js";

export default {
  command: Cli.create("transfer", {
    description: "Pay an MPP challenge with MACH",
    globals: cliGlobals,
    options: transferOptions,
    alias: globalAlias,
    output: transferOutput,
    examples: [{ options: { "max-spend": "5", "mpp-challenge": "<WWW_AUTHENTICATE>" } }],
    async run(context) {
      const { globals, options } = context;
      const flags = { ...options, network: globals.network };
      // A TEMPO_PRIVATE_KEY payer stands in for the logged-in wallet.
      if (process.env.TEMPO_PRIVATE_KEY) return transferMach({ options: flags });
      return withWallet((_, wallet) =>
        transferMach({ options: { ...flags, network: wallet.network.name } }),
      )(context);
    },
  }),
  annotations: { transfer: { ...destructive, idempotentHint: false, openWorldHint: true } },
} satisfies WalletCommand;
