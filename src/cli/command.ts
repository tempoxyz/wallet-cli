import type { Cli, Mcp } from "incur";

/** What each command module default-exports for `tempo wallet` to mount. */
export type WalletCommand = {
  /** The incur command, or a group of them. */
  command: Cli.Cli<any, any, any, any, any>;
  /**
   * MCP tool annotations by tool name (`keys update` is `keys_update`), so clients can tell reads
   * from spends. Refreshing the service directory cache is a read; storing discovered sessions is
   * an additive change. Moving funds, changing or revoking a key, closing a session, replacing or
   * deleting stored sessions, and replacing or deleting the stored wallet or its network are
   * destructive. `openWorldHint` marks tools that reach the chain RPC, the wallet app, or another
   * server. Only MCP tools carry them: incur would also turn a command's own `mcp.annotations`
   * into confirmation hints in `--llms-full` and synced skills.
   */
  annotations: Record<string, Mcp.ToolAnnotations>;
};

export const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
export const nonDestructive = { readOnlyHint: false, destructiveHint: false };
export const destructive = { readOnlyHint: false, destructiveHint: true };
