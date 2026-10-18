import { Cli, type Mcp, type z } from "incur";

import { walletError } from "../shared/errors.js";
import type { RetiredFlag } from "./argv.js";

/** What each command module default-exports for `tempo wallet` to mount and describe. */
export type WalletCommand = {
  /** The incur command, or a group of them; unset for incur's builtins, which incur mounts. */
  command?: Cli.Cli<any, any, any, any, any> | undefined;
  /** For incur's builtins, which incur defines and mounts, what wallet documents of them. */
  builtin?: Builtin | undefined;
  /**
   * MCP tool annotations by tool name (`keys update` is `keys_update`), so clients can tell reads
   * from spends. Refreshing the service directory cache is a read; storing discovered sessions is
   * an additive change. Moving funds, changing or revoking a key, closing a session, replacing or
   * deleting stored sessions, and replacing or deleting the stored wallet or its network are
   * destructive. `openWorldHint` marks tools that reach the chain RPC, the wallet app, or another
   * server. Only MCP tools carry them: incur would also turn a command's own `mcp.annotations`
   * into confirmation hints in `--llms-full` and synced skills.
   */
  annotations?: Record<string, Mcp.ToolAnnotations> | undefined;
  /** Left out of `--describe`, as `completions` is. */
  hidden?: boolean | undefined;
  /** Flags an earlier form of it took, each failing with what replaces it; see `retireFlags`. */
  retiredFlags?: readonly RetiredFlag[] | undefined;
};

/** The parts of an incur command definition that `--describe` and the README document. */
export type CommandDefinition = {
  description?: string | undefined;
  args?: z.ZodObject | undefined;
  options?: z.ZodObject | undefined;
  alias?: Record<string, string | undefined> | undefined;
};

/** One of incur's builtin commands or their subcommands, which incur does not export. */
export type Builtin = CommandDefinition & {
  name: string;
  aliases?: string[] | undefined;
  subcommands?: Builtin[] | undefined;
};

export const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
export const nonDestructive = { readOnlyHint: false, destructiveHint: false };
export const destructive = { readOnlyHint: false, destructiveHint: true };

/** The commands, groups, and aliases incur has mounted on `cli`, by name. */
export function commandMap(cli: Cli.Cli<any, any, any, any, any>) {
  // incur keys this map by the default Cli type; the globals generic does not change the entry.
  const entries = Cli.toCommands.get(cli as never);
  if (!entries)
    throw walletError({ code: "E_RUNTIME", message: "Unable to access wallet commands" });
  return entries as Map<string, unknown>;
}

/** A group in incur's command map; `root` is the group's own command, as in bare `sessions`. */
export function isCommandGroup(
  value: unknown,
): value is { commands: Map<string, unknown>; root?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "_group" in value &&
    "commands" in value &&
    value.commands instanceof Map
  );
}

/** A command incur can run, with the fields wallet reads from it. */
export type RunnableCommand = {
  alias?: Record<string, string | undefined> | undefined;
  options?: z.ZodObject | undefined;
  output?: unknown;
  run: (context: unknown) => unknown | Promise<unknown>;
};

/**
 * The output schema of the command at `path` (`keys list`, or `sessions` for a group's own command)
 * in incur's command map, if it has one.
 */
export function outputSchema(commands: Map<string, unknown>, path: string) {
  let entry: unknown;
  let group: Map<string, unknown> | undefined = commands;
  for (const name of path.split(" ")) {
    entry = group?.get(name);
    group = isCommandGroup(entry) ? entry.commands : undefined;
  }
  const command = isCommandGroup(entry) ? entry.root : entry;
  const output = isRunnableCommand(command) ? command.output : undefined;
  return typeof output === "object" && output !== null && "_zod" in output
    ? (output as z.core.$ZodType)
    : undefined;
}

export function isRunnableCommand(value: unknown): value is RunnableCommand {
  return (
    typeof value === "object" && value !== null && "run" in value && typeof value.run === "function"
  );
}
