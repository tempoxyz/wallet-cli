#!/usr/bin/env node
import { Cli } from "incur";

import { expandHelp, normalizeServicesOutputAliases } from "./cli/argv.js";
import { handleBuiltinSchema } from "./cli/builtins.js";
import { commandMap } from "./cli/command.js";
import { commands } from "./cli/commands.js";
import { walletCompletions } from "./cli/completions.js";
import { describeCli } from "./cli/describe.js";
import { bindCommandOptions } from "./cli/incur-compat.js";
import { serveMcp } from "./cli/mcp.js";
import { closeCommandFailed } from "./commands/sessions/close.js";
import { cliGlobalAlias, cliGlobals } from "./schemas/shared.js";
import { version } from "./shared/constants.js";
import { ctaErrors } from "./shared/errors.js";

const cli = Cli.create("tempo wallet", {
  version,
  description: "Wallet identity and custody operations",
  sync: {
    suggestions: [
      "log in to a Tempo wallet",
      "show the current Tempo wallet account",
      "transfer tokens with the Tempo wallet CLI",
    ],
  },
  globals: cliGlobals,
  globalAlias: cliGlobalAlias,
  // The Tempo launcher manages updates, so skip incur npm update checks.
  update: false,
});

// Returns a thrown CtaError through `c.error`, so it keeps its cta; `serveMcp` registers it too.
cli.use(ctaErrors);

for (const { command } of commands) if (command) cli.command(command);

void main();

export default cli;

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes("--describe")) {
    process.stdout.write(`${JSON.stringify(describeCli(commands))}\n`);
    process.exit(0);
  }

  const mounted = commandMap(cli);
  const args = expandHelp(normalizeServicesOutputAliases(bindCommandOptions(rawArgs, mounted)));

  if (handleBuiltinSchema(args)) process.exit(0);

  if (args.includes("--mcp")) {
    await serveMcp(cli, commands);
    return;
  }

  const script = walletCompletions(args, mounted, commands);
  if (script !== undefined) {
    process.stdout.write(`${script}\n`);
    return;
  }

  await cli.serve(args);
  // Preserve the summary on stdout; only a one-shot CLI invocation changes exit status.
  if (closeCommandFailed) process.exitCode = 1;
}
