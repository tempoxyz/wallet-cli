import { Cli, type z } from "incur";

import type { RetiredFlag } from "../cli/argv.js";
import { destructive, type WalletCommand } from "../cli/command.js";
import { flag, option, positional } from "../cli/describe.js";
import { sendArgs, sendOptions, sendOutput } from "../schemas/send.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import type { CommandContext } from "../shared/errors.js";
import { canPrompt } from "../shared/process.js";
import { withWallet } from "../shared/require-wallet.js";
import { transferNetworkRefusal, transferTokens } from "./transfer/tokens.js";
import { deferredKeyRefusal, defersKeyCheck, idempotencyKeyArg } from "./tx.js";

// The definition is declared apart from `Cli.create`, so its run context is typed here. A token
// `transfer` runs it too, with each argument optional.
type SendContext = CommandContext & {
  args: { amount?: string | undefined; token?: string | undefined; to?: string | undefined };
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof sendOptions>;
};

/** `send`, which the deprecated token form of `transfer` also runs. */
export const sendCommand = {
  description: "Send tokens to an address",
  args: sendArgs,
  options: sendOptions,
  alias: globalAlias,
  output: sendOutput,
  examples: [
    {
      args: { amount: "50", token: "0x20c0...b50", to: "0x70997...9C8" },
      options: { "dry-run": true },
    },
    { args: { amount: "1.00", token: "USDC.e", to: "0x70997...9C8" }, options: { yes: true } },
  ],
  run(context: SendContext) {
    const { options } = context;
    const deferKey = defersKeyCheck(options);
    return withWallet(
      async (_, wallet) => {
        const result = await transferTokens(wallet, {
          args: context.args,
          options,
          interactive: canPrompt(context.agent),
          keyRequired: deferKey ? deferredKeyRefusal(context.agent, wallet) : undefined,
        });
        // A refusal that needs a login on the selected network is returned, keeping its `cta`.
        return "code" in result ? context.error(result) : result;
      },
      {
        // An interactive send without a usable access key is approved in the wallet app instead.
        requireKey: deferKey ? "never" : "agent",
        // That refusal also comes before the key check: a key there would not lift it.
        refuse: (_, wallet) => (options["dry-run"] ? undefined : transferNetworkRefusal(wallet)),
      },
    )(context);
  },
};

export const sendAnnotations = { ...destructive, idempotentHint: false, openWorldHint: true };

/** `send` takes no `transfer` mode: `--mach` and `--credits` pay with `transfer` instead. */
function transferMode(flag: "--mach" | "--credits", purpose: string): RetiredFlag {
  return {
    flag,
    replacement: ({ args }) => ({
      message: `'send' sends tokens only; to ${purpose}, use 'tempo wallet transfer ${flag}'.`,
      argv: ["transfer", flag, ...args],
    }),
  };
}

export default {
  command: Cli.create("send", { ...sendCommand, globals: cliGlobals }),
  annotations: { send: sendAnnotations },
  describe: {
    name: "send",
    about: "Send tokens to an address",
    args: [
      positional("amount", 'Amount in human units ("1.00", "50")'),
      positional("token", "Token address (0x...) or symbol (e.g. USDC.e)"),
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
      option("address", "--address", "Wallet address (defaults to current wallet)", {
        valueName: "ADDRESS",
      }),
    ],
  },
  retiredFlags: [
    transferMode("--mach", "pay an MPP challenge with MACH"),
    transferMode("--credits", "spend legacy MPP Credits"),
  ],
} satisfies WalletCommand;
