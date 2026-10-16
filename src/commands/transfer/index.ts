import { Cli } from "incur";

import type { WalletCommand } from "../../cli/command.js";
import { flag, option, positional } from "../../cli/describe.js";
import { cliGlobals, globalAlias } from "../../schemas/shared.js";
import { transferArgs, transferOptions, transferOutput } from "../../schemas/transfer.js";
import { usageError } from "../../shared/errors.js";
import { withWallet } from "../../shared/require-wallet.js";
import { sendAnnotations, sendCommand } from "../send.js";
import { idempotencyKeyArg } from "../tx.js";
import { transferCredits } from "./credits.js";
import { transferMach } from "./mach.js";

// Token transfers moved to `send`; MACH and MPP Credits payments stay here.
const transferDescription =
  "Deprecated: use 'send' for token transfers. Pays an MPP challenge with --mach or --credits";

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
  annotations: { transfer: sendAnnotations },
  describe: {
    name: "transfer",
    about: transferDescription,
    args: [
      positional("amount", 'Amount in human units ("1.00", "50") — required for token transfers'),
      positional(
        "token",
        "Token address (0x...) or symbol (e.g. USDC.e) — required for token transfers",
      ),
      positional("to", "Recipient address (0x...)"),
      option(
        "fee_token",
        "--fee-token",
        "Pay fees in a different token, by address or symbol (default: the account's fee token, else the same token)",
        { valueName: "FEE_TOKEN" },
      ),
      flag("dry_run", "--dry-run", "Show plan, fee estimate, and balance; don't send"),
      flag("yes", "--yes", "Send without the confirmation prompt; required for agent runs"),
      idempotencyKeyArg,
      flag("mach", "--mach", "Pay with on-chain MACH"),
      flag("credits", "--credits", "Spend existing MPP Credits (deprecated)"),
      option("max_spend", "--max-spend", "Maximum MACH spend in USD", { valueName: "AMOUNT" }),
      option(
        "amount_cents",
        "--amount-cents",
        "Credits amount or MPP challenge spending cap in USD cents",
        { valueName: "AMOUNT_CENTS" },
      ),
      option("credits_to", "--to", "Credits recipient; unsupported with MACH", {
        valueName: "CREDITS_TO",
      }),
      option("data", "--data", "Credits calldata; unsupported with MACH", {
        valueName: "DATA",
      }),
      option("value", "--value", "Credits ETH value (must be zero); unsupported with MACH", {
        valueName: "VALUE",
      }),
      option("mpp_challenge", "--mpp-challenge", "MPP WWW-Authenticate challenge", {
        valueName: "MPP_CHALLENGE",
      }),
      option(
        "mpp_challenge_file",
        "--mpp-challenge-file",
        "File containing an MPP WWW-Authenticate challenge",
        { valueName: "MPP_CHALLENGE_FILE" },
      ),
      option(
        "mpp_client_id",
        "--mpp-client-id",
        "Optional client ID to include in the generated MPP attribution memo",
        { valueName: "MPP_CLIENT_ID" },
      ),
      option("address", "--address", "Wallet address (defaults to current wallet)", {
        valueName: "ADDRESS",
      }),
    ],
  },
} satisfies WalletCommand;
