import { Cli, type Mcp, type z } from "incur";

import { walletError } from "../shared/errors.js";
import type { RetiredFlag } from "./argv.js";
import type { Describe } from "./describe.js";

/** What each command module default-exports for `tempo wallet` to mount and describe. */
export type WalletCommand = {
  /** The incur command, or a group of them; unset for incur's builtins, which incur mounts. */
  command?: Cli.Cli<any, any, any, any, any> | undefined;
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
  /** The `--describe` entry. Optional: a command without one, like `completions`, is left out. */
  describe?: Describe | undefined;
  /** Flags an earlier form of it took, each failing with what replaces it; see `retireFlags`. */
  retiredFlags?: readonly RetiredFlag[] | undefined;
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

export function isRunnableCommand(value: unknown): value is RunnableCommand {
  return (
    typeof value === "object" && value !== null && "run" in value && typeof value.run === "function"
  );
}
