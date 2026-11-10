import { Cli, type z } from "incur";

import { destructive, type WalletCommand } from "../cli/command.js";
import { sendArgs, sendOptions, sendOutput } from "../schemas/send.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import type { CommandContext } from "../shared/errors.js";
import { canPrompt } from "../shared/process.js";
import { withWallet } from "../shared/require-wallet.js";
import { transferNetworkRefusal, transferTokens } from "./transfer/tokens.js";
import { deferredKeyRefusal, defersKeyCheck } from "./tx.js";

// The definition is declared apart from `Cli.create`, so its run context is typed here.
type SendContext = CommandContext & {
  args: { amount?: string | undefined; token?: string | undefined; to?: string | undefined };
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof sendOptions>;
};

/** Sends tokens to an address. */
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

export default {
  command: Cli.create("send", { ...sendCommand, globals: cliGlobals }),
  annotations: { send: sendAnnotations },
} satisfies WalletCommand;
