#!/usr/bin/env node
import { Cli } from "incur";

import { expandHelp, normalizeServicesArgs, retireFlags } from "./cli/argv.js";
import { handleBuiltinSchema } from "./cli/builtins.js";
import { commandMap } from "./cli/command.js";
import { commands } from "./cli/commands.js";
import { walletCompletions } from "./cli/completions.js";
import { describeCli } from "./cli/describe.js";
import { bindCommandOptions, ctaErrors, humanRun, serveHuman } from "./cli/incur-compat.js";
import { serveMcp } from "./cli/mcp.js";
import { closeCommandFailed } from "./commands/sessions/close.js";
import { cliGlobalAlias, cliGlobals } from "./schemas/shared.js";
import { version } from "./shared/constants.js";
import { configSnapshot } from "./wallet/config.js";

// A person's run on a terminal is rendered from incur's JSON result; see `serveHuman`.
const human = humanRun(expandHelp(process.argv.slice(2)));

const cli = Cli.create("tempo wallet", {
  version,
  description: "Wallet identity and custody operations",
  sync: {
    suggestions: [
      "log in to a Tempo wallet",
      "show the current Tempo wallet account",
      "send tokens with the Tempo wallet CLI",
    ],
  },
  globals: cliGlobals,
  globalAlias: cliGlobalAlias,
  // The Tempo launcher manages updates, so skip incur npm update checks.
  update: false,
  ...(human ? { format: "json" as const } : {}),
});

// Returns a thrown CtaError through `c.error`, so it keeps its cta; `serveMcp` registers it too.
cli.use(ctaErrors);
// Each command reads the config file once; see `withConfigSnapshot`.
cli.use(configSnapshot);

for (const { command } of commands) if (command) cli.command(command);

void main();

export default cli;

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes("--describe")) {
    process.stdout.write(`${JSON.stringify(describeCli(cli, commands))}\n`);
    process.exit(0);
  }

  const mounted = commandMap(cli);
  // A retired flag is stripped with its value first, so a value such as `--mcp` stays its value.
  const { args, error } = retireFlags(
    normalizeServicesArgs(expandHelp(bindCommandOptions(rawArgs, mounted))),
    commands,
  );

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

  // Middleware runs before the command parses its options, so a retired flag runs nothing.
  if (error) cli.use((context) => context.error(error));

  if (human) {
    const exitCode = await serveHuman(cli, args);
    if (exitCode !== undefined) process.exit(exitCode);
  } else await cli.serve(args);
  // Preserve the summary on stdout; only a one-shot CLI invocation changes exit status.
  if (closeCommandFailed) process.exitCode = 1;
}
