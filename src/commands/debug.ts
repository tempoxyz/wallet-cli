import { Cli } from "incur";

import { readOnly, type WalletCommand } from "../cli/command.js";
import { doctorOutput } from "../schemas/doctor.js";
import { cliGlobals, globalAlias, globalOptions } from "../schemas/shared.js";
import { doctorHandler } from "./doctor.js";

export default {
  command: Cli.create("debug", {
    description: "Deprecated: use 'doctor'",
    globals: cliGlobals,
    options: globalOptions,
    alias: globalAlias,
    output: doctorOutput,
    async run({ globals }) {
      return debugHandler(globals);
    },
  }),
  annotations: { debug: { ...readOnly, openWorldHint: true } },
  describe: { name: "debug", about: "Deprecated: use 'doctor'" },
} satisfies WalletCommand;

export async function debugHandler(options: { network?: string | undefined }) {
  console.error("Warning: 'tempo wallet debug' is deprecated; use 'tempo wallet doctor'.");
  return await doctorHandler(options);
}
