import { Cli } from "incur";

import { flagSet } from "../../cli/argv.js";
import { destructive, type WalletCommand } from "../../cli/command.js";
import { cliGlobals, globalAlias } from "../../schemas/shared.js";
import { transferArgs, transferOptions, transferOutput } from "../../schemas/transfer.js";
import { usageError } from "../../shared/errors.js";
import { withWallet } from "../../shared/require-wallet.js";
import { creditsFlag } from "../../shared/retired-flags.js";
import { removedTransferFlags, sendArgv, sendCommand, valueFlag } from "../send.js";
import { machAmountCentsFlag, transferMach } from "./mach.js";

// `transfer` pays MPP challenges; its token form is `send` under a deprecated name.
const transferDescription = "Pay an MPP challenge with --mach. Token transfers moved to 'send'.";

export default {
  command: Cli.create("transfer", {
    description: transferDescription,
    globals: cliGlobals,
    args: transferArgs,
    options: transferOptions,
    alias: globalAlias,
    output: transferOutput,
    examples: [
      { options: { mach: true, "max-spend": "5", "mpp-challenge": "<WWW_AUTHENTICATE>" } },
    ],
    async run(context) {
      const { args, globals, options } = context;
      const flags = { ...options, network: globals.network };
      if (options.mach && options["idempotency-key"] !== undefined)
        throw usageError("--idempotency-key applies only to token transfers");
      if (options.mach && Object.values(args).some((value) => value !== undefined))
        throw usageError(
          "Positional transfer arguments cannot be used with --mach; supply an MPP challenge",
        );
      // A TEMPO_PRIVATE_KEY payer stands in for the logged-in wallet.
      if (options.mach && process.env.TEMPO_PRIVATE_KEY) return transferMach({ options: flags });
      // MACH pays with the stored access key, never the wallet app.
      if (options.mach)
        return withWallet((_, wallet) =>
          transferMach({ options: { ...flags, network: wallet.network.name } }),
        )(context);
      // A token transfer is `send` under its former name, for a release or two. Only a person at
      // a terminal sees the notice; agent runs (MCP, `--format`, or stdout not a terminal) get
      // exactly what `send` returns.
      if (!context.agent)
        console.error(
          "Warning: 'tempo wallet transfer <amount> <token> <to>' is deprecated; use 'tempo wallet send <amount> <token> <to>'.",
        );
      return sendCommand.run(context);
    },
  }),
  // MACH payments, like a token send, move funds over the network.
  annotations: { transfer: { ...destructive, idempotentHint: false, openWorldHint: true } },
  retiredFlags: [
    creditsFlag,
    ...removedTransferFlags,
    machAmountCentsFlag,
    {
      ...valueFlag((args) => (paysWithMode(args) ? ["transfer", ...args] : sendArgv(args))),
      mcp: true,
    },
  ],
} satisfies WalletCommand;

/** Whether a `transfer` run pays with `--mach` rather than sending tokens. */
function paysWithMode(args: readonly string[]) {
  return flagSet(args, "--mach");
}
