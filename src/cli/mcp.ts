import { Mcp, type Cli } from "incur";

import { deprecatedCommand } from "../commands/services/deprecated.js";
import { staleListFetchedAt } from "../commands/services/directory.js";
import { servicesListMcpOutput, servicesMcpOutput } from "../schemas/services.js";
import { version } from "../shared/constants.js";
import { configSnapshot } from "../wallet/config.js";
import {
  commandMap,
  isCommandGroup,
  isRunnableCommand,
  type RunnableCommand,
  type WalletCommand,
} from "./command.js";
import { ctaErrors, withMcpGlobal } from "./incur-compat.js";

/** Serves the commands mounted on `cli` as MCP tools over stdio. */
export async function serveMcp(
  cli: Cli.Cli<any, any, any, any, any>,
  commands: readonly WalletCommand[],
) {
  await Mcp.serve(cli.name, version, createMcpCommands(commandMap(cli), commands), {
    env: cli.env,
    middlewares: [ctaErrors, configSnapshot],
    tools: { discovery: "direct" },
    vars: cli.vars,
    version,
  });
}

/**
 * The command tree `serveMcp` serves: each tool annotated, bare `sessions` left out, and the
 * deprecated `services` tool in place of bare `services`.
 */
export function createMcpCommands(
  mounted: Map<string, unknown>,
  commands: readonly WalletCommand[],
) {
  // Each tool's annotations by tool name, from the `annotations` of its command.
  const annotations = Object.fromEntries(
    commands.flatMap((command) => Object.entries(command.annotations ?? {})),
  );
  const mcpCommands = mcpTools(mounted, annotations);
  const sessionsGroup = mcpCommands.get("sessions");
  if (isCommandGroup(sessionsGroup)) {
    // Bare `sessions` is CLI shorthand; MCP already exposes `sessions_list`.
    const { root: _root, ...group } = sessionsGroup;
    mcpCommands.set("sessions", group);
  }
  const servicesGroup = mcpCommands.get("services");
  if (isCommandGroup(servicesGroup)) {
    const commands = new Map(servicesGroup.commands);
    for (const name of ["list", "search"]) {
      const command = commands.get(name);
      if (isRunnableCommand(command))
        commands.set(name, wrapServiceList(command, servicesListMcpOutput));
    }
    mcpCommands.set("services", {
      ...servicesGroup,
      // Bare `services` lists in the CLI; the `services` tool stays the deprecated one for a release.
      // Its `run` takes incur's typed context, which `RunnableCommand` leaves unknown.
      root: wrapServiceList(
        mcpTool(deprecatedCommand as RunnableCommand, ["services"], annotations),
        servicesMcpOutput,
      ),
      commands,
    });
  }

  return mcpCommands;
}

/**
 * MCP structuredContent must be a top-level object, so a service list becomes `{ services }`,
 * with `stale` and `fetched_at` when it came from an expired cache. CLI output stays a list.
 */
function wrapServiceList(command: RunnableCommand, output: unknown) {
  return {
    ...command,
    output,
    async run(context: unknown) {
      const value = await command.run(context);
      if (!Array.isArray(value)) return value;
      const fetchedAt = staleListFetchedAt(value);
      return { services: value, ...(fetchedAt ? { stale: true, fetched_at: fetchedAt } : {}) };
    },
  };
}

/**
 * Each tool declares its `annotations` entry, found by the tool name incur gives it
 * (`keys update` is `keys_update`), and accepts the CLI globals; see `withMcpGlobal`.
 */
function mcpTools(
  commands: Map<string, unknown>,
  annotations: Record<string, Mcp.ToolAnnotations>,
  prefix: readonly string[] = [],
): Map<string, unknown> {
  return new Map(
    [...commands].map(([name, entry]) => {
      const path = [...prefix, name];
      if (isCommandGroup(entry))
        return [
          name,
          {
            ...entry,
            // A group root (bare `login`) is a tool of its own.
            ...(isRunnableCommand(entry.root)
              ? { root: mcpTool(entry.root, path, annotations) }
              : {}),
            commands: mcpTools(entry.commands, annotations, path),
          },
        ];
      return [name, isRunnableCommand(entry) ? mcpTool(entry, path, annotations) : entry];
    }),
  );
}

function mcpTool(
  entry: RunnableCommand,
  path: readonly string[],
  annotations: Record<string, Mcp.ToolAnnotations>,
) {
  return withMcpGlobal({ ...entry, mcp: { annotations: annotations[path.join("_")] } });
}
