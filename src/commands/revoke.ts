import { Cli } from "incur";

import type { WalletCommand } from "../cli/command.js";
import { cliGlobals } from "../schemas/shared.js";
import { revokeAnnotations, revokeCommand, revokeDescribe } from "./keys.js";

// `keys revoke` under its former name, for a release or two.
export default {
  command: Cli.create("revoke", {
    ...revokeCommand,
    description: "Deprecated: use 'keys revoke'",
    globals: cliGlobals,
    // Only a person at a terminal sees the notice; agent runs (MCP, `--format`, or stdout not a
    // terminal) get exactly what `keys revoke` returns.
    async run(context) {
      if (!context.agent)
        console.error(
          "Warning: 'tempo wallet revoke' is deprecated; use 'tempo wallet keys revoke'.",
        );
      return revokeCommand.run(context);
    },
  }),
  annotations: { revoke: revokeAnnotations },
  describe: { ...revokeDescribe, about: "Deprecated: use 'keys revoke'" },
} satisfies WalletCommand;
