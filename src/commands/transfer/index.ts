import { Cli } from "incur";

import { destructive, type WalletCommand } from "../../cli/command.js";
import { flag, option, positional } from "../../cli/describe.js";
import { cliGlobals, globalAlias } from "../../schemas/shared.js";
import { transferArgs, transferOptions, transferOutput } from "../../schemas/transfer.js";
import { usageError } from "../../shared/errors.js";
import { canPrompt } from "../../shared/process.js";
import { withWallet } from "../../shared/require-wallet.js";
import { deferredKeyRefusal, defersKeyCheck, idempotencyKeyArg } from "../tx.js";
import { transferCredits } from "./credits.js";
import { transferMach } from "./mach.js";
import { transferNetworkRefusal, transferTokens } from "./tokens.js";

export default {
  command: Cli.create("transfer", {
    description: "Transfer tokens to an address",
    globals: cliGlobals,
    args: transferArgs,
    options: transferOptions,
    alias: globalAlias,
    output: transferOutput,
    examples: [
      {
        args: { amount: "50", token: "0x20c0...b50", to: "0x70997...9C8" },
        options: { "dry-run": true },
      },
      { args: { amount: "1.00", token: "USDC.e", to: "0x70997...9C8" }, options: { yes: true } },
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
      // MACH pays with the stored access key; a token transfer without one, run interactively,
      // is approved in the wallet app instead.
      const deferKey = defersKeyCheck(options);
      return withWallet(
        async (_, wallet) => {
          if (options.mach)
            return transferMach({ options: { ...flags, network: wallet.network.name } });
          const result = await transferTokens(wallet, {
            args,
            options,
            interactive: canPrompt(context.agent),
            keyRequired: deferKey ? deferredKeyRefusal(context.agent, wallet) : undefined,
          });
          // A refusal that needs a login on the selected network is returned, keeping its `cta`.
          return "code" in result ? context.error(result) : result;
        },
        {
          requireKey: options.mach ? "always" : deferKey ? "never" : "agent",
          // That refusal also comes before the key check: a key there would not lift it.
          refuse: (_, wallet) =>
            options.mach || options["dry-run"] ? undefined : transferNetworkRefusal(wallet),
        },
      )(context);
    },
  }),
  annotations: { transfer: { ...destructive, idempotentHint: false, openWorldHint: true } },
  describe: {
    name: "transfer",
    about: "Transfer tokens to an address",
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
