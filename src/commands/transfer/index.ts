import { Cli } from "incur";

import { flagSet } from "../../cli/argv.js";
import { destructive, type WalletCommand } from "../../cli/command.js";
import { cliGlobals, globalAlias } from "../../schemas/shared.js";
import { transferArgs, transferOptions, transferOutput } from "../../schemas/transfer.js";
import { usageError } from "../../shared/errors.js";
import { withWallet } from "../../shared/require-wallet.js";
import { creditsOnlyFlags, sendArgv, sendCommand, valueFlag } from "../send.js";
import { transferCredits } from "./credits.js";
import { machAmountCentsError, machAmountCentsFlag, transferMach } from "./mach.js";

// `transfer` pays MPP challenges; its token form is `send` under a deprecated name.
const transferDescription =
  "Pay an MPP challenge with --mach or --credits. Token transfers moved to 'send'.";

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
      if (options.credits && options.mach) throw usageError("Use only one of --credits and --mach");
      if ((options.credits || options.mach) && options["idempotency-key"] !== undefined)
        throw usageError("--idempotency-key applies only to token transfers");
      // MCP still passes the former MACH cap in cents, which the CLI refuses before parsing; it
      // is refused, not dropped for another cap.
      if (options.mach && options["amount-cents"] !== undefined)
        throw machAmountCentsError(flags, options["amount-cents"]);
      if (options.credits) {
        // MCP puts the shared `to` field in args; a CLI positional recipient needs amount and token.
        if (args.amount !== undefined || args.token !== undefined)
          throw usageError(
            "Positional amount, token, and recipient arguments cannot be used with --credits; use --amount-cents and --to, or an MPP challenge",
          );
        // Credits are signed by the wallet app, not the local access key.
        return transferCredits({ options: { ...flags, to: options.to ?? args.to } });
      }
      // A TEMPO_PRIVATE_KEY payer stands in for the logged-in wallet.
      if (options.mach && process.env.TEMPO_PRIVATE_KEY) return transferMach({ options: flags });
      // MACH pays with the stored access key, never the wallet app.
      if (options.mach)
        return withWallet((_, wallet) =>
          transferMach({ options: { ...flags, network: wallet.network.name } }),
        )(context);
      // MCP passes the credits options the CLI refuses before parsing; a token transfer takes none.
      const credit = creditsOnlyFlags.find(
        ({ flag }) => options[flag.slice(2) as "to" | "data" | "amount-cents"] !== undefined,
      );
      if (credit)
        throw usageError(credit.replacement({ given: [], args: [], value: undefined }).message);
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
  // MACH and MPP Credits payments, like a token send, move funds over the network.
  annotations: { transfer: { ...destructive, idempotentHint: false, openWorldHint: true } },
  // `--credits` keeps its options, and MACH refuses `--to` and `--data` itself.
  retiredFlags: [
    ...creditsOnlyFlags,
    machAmountCentsFlag,
    {
      ...valueFlag((args) => (paysWithMode(args) ? ["transfer", ...args] : sendArgv(args))),
      mcp: true,
    },
  ],
} satisfies WalletCommand;

/** Whether a `transfer` run pays with `--mach` or `--credits` rather than sending tokens. */
function paysWithMode(args: readonly string[]) {
  return flagSet(args, "--mach") || flagSet(args, "--credits");
}
