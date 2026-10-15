import { Cli } from "incur";

import { readOnly, type WalletCommand } from "../cli/command.js";
import { supportedShells } from "../completions.js";
import { completionsArgs, completionsOutput } from "../schemas/completions.js";
import { globalAlias, globalOptions } from "../schemas/shared.js";

export default {
  command: Cli.create("completions", {
    description: "Generate shell completions script",
    args: completionsArgs,
    options: globalOptions,
    alias: globalAlias,
    output: completionsOutput,
    run() {
      return completionsHandler();
    },
  }),
  annotations: { completions: { ...readOnly, openWorldHint: false } },
} satisfies WalletCommand;

export function completionsHandler() {
  return {
    supported_shells: [...supportedShells],
  };
}
