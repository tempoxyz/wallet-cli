import { Cli, type z } from "incur";

import { flagSet, operandIndexes, type RetiredFlag } from "../cli/argv.js";
import { destructive, type WalletCommand } from "../cli/command.js";
import { sendArgs, sendOptions, sendOutput } from "../schemas/send.js";
import { transferOptions } from "../schemas/transfer.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import type { CommandContext } from "../shared/errors.js";
import { canPrompt } from "../shared/process.js";
import { creditsFlag } from "../shared/retired-flags.js";
import { withWallet } from "../shared/require-wallet.js";
import { transferNetworkRefusal, transferTokens } from "./transfer/tokens.js";
import { deferredKeyRefusal, defersKeyCheck } from "./tx.js";

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

/**
 * `send` takes no `transfer` mode: `--mach` pays with `transfer` instead, which the
 * `cta` runs with the arguments as given. An explicit false selects no mode, so `send` runs.
 */
function transferMode(flag: "--mach", purpose: string): RetiredFlag {
  return {
    flag,
    replacement: ({ given }) => ({
      message: `'send' sends tokens only; to ${purpose}, use 'tempo wallet transfer ${flag}'.`,
      argv: ["transfer", ...given],
    }),
  };
}

// A run with `--mach` pays with `transfer`, whose own checks name what applies.
const paymentModes = ["--mach"] as const;

/**
 * The options `transfer` takes and `send` does not, such as `--max-spend`. A mode left in a token
 * run is an explicit false, which `send` also reads as no mode.
 */
const transferOnly = Object.keys(transferOptions.shape)
  .filter((name) => !Object.hasOwn(sendOptions.shape, name))
  .map((name) => `--${name}`)
  .filter((flag) => !(paymentModes as readonly string[]).includes(flag));

/**
 * `send` with `args`, or `undefined` when they select a mode or option only `transfer` takes,
 * so a `cta` is never a `send` that refuses the given flags.
 */
export function sendArgv(args: readonly string[]) {
  if (flagSet(args, "--mach")) return undefined;
  const transferOption = args.some((arg) =>
    transferOnly.some(
      (flag) => arg === flag || arg.startsWith(`${flag}=`) || arg === `--no-${flag.slice(2)}`,
    ),
  );
  return transferOption ? undefined : ["send", ...args];
}

/**
 * Removed transfer options. With the amount and
 * token given, the `cta` of `--to` passes the recipient after them.
 */
export const removedTransferFlags: RetiredFlag[] = [
  {
    flag: "--to",
    takesValue: true,
    replacement: ({ args, value }) => {
      // A `true` or `false` after a flag is that flag's value, not an argument.
      const operands = operandIndexes(args).filter(
        (index) => !["true", "false"].includes(args[index]!) || !args[index - 1]?.startsWith("-"),
      );
      const token = operands.length === 2 ? operands[1]! + 1 : undefined;
      return {
        message:
          "--to was removed; pass a token transfer's recipient as the third argument: 'tempo wallet send <amount> <token> <to>'.",
        argv:
          token === undefined || value === undefined
            ? undefined
            : sendArgv([...args.slice(0, token), value, ...args.slice(token)]),
      };
    },
  },
  {
    flag: "--data",
    takesValue: true,
    mcp: true,
    replacement: () => ({
      message: "--data was removed; a token transfer sends no calldata.",
    }),
  },
  {
    flag: "--amount-cents",
    takesValue: true,
    unless: paymentModes,
    mcp: true,
    replacement: () => ({
      message:
        "--amount-cents was removed; use --max-spend with --mach, or pass a token transfer's amount in token units as the first argument: 'tempo wallet send <amount> <token> <to>'.",
    }),
  },
];

/**
 * `--value` had to be zero. Its `cta` is the same run without it, as `command` builds it
 * from the arguments.
 */
export function valueFlag(command: (args: string[]) => string[] | undefined): RetiredFlag {
  return {
    flag: "--value",
    takesValue: true,
    replacement: ({ args, value }) => ({
      message: "--value was removed: transfers carry no ETH value.",
      argv: value !== undefined && /^(?:0*|0x0*)$/.test(value.trim()) ? command(args) : undefined,
    }),
  };
}

export default {
  command: Cli.create("send", { ...sendCommand, globals: cliGlobals }),
  annotations: { send: sendAnnotations },
  retiredFlags: [
    transferMode("--mach", "pay an MPP challenge with MACH"),
    creditsFlag,
    ...removedTransferFlags,
    valueFlag(sendArgv),
  ],
} satisfies WalletCommand;
