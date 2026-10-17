import { Mcp, z, type Cli } from "incur";

import { deprecatedCommand } from "../commands/services/deprecated.js";
import { staleListFetchedAt } from "../commands/services/directory.js";
import { servicesListMcpOutput, servicesMcpOutput } from "../schemas/services.js";
import { version } from "../shared/constants.js";
import { errorCodes } from "../shared/errors.js";
import { configSnapshot } from "../wallet/config.js";
import type { RetiredFlag } from "./argv.js";
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
 * The command tree `serveMcp` serves: each tool annotated, bare `sessions` left out, the
 * deprecated `services` tool in place of bare `services`, and retired arguments refused.
 */
export function createMcpCommands(
  mounted: Map<string, unknown>,
  commands: readonly WalletCommand[],
) {
  // Each tool's annotations by tool name, from the `annotations` of its command.
  const annotations = Object.fromEntries(
    commands.flatMap((command) => Object.entries(command.annotations ?? {})),
  );
  // The retired flags each tool took as arguments, by tool name; see `refuseRetired`.
  const retired = Object.fromEntries(
    commands.flatMap(({ command, retiredFlags = [] }) => {
      const flags = retiredFlags.filter((flag) => flag.mcp);
      return command && flags.length > 0 ? [[command.name, flags]] : [];
    }),
  );
  const mcpCommands = mcpTools(mounted, annotations, retired);
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
        mcpTool(deprecatedCommand as RunnableCommand, ["services"], annotations, retired),
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
  retired: Record<string, readonly RetiredFlag[]>,
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
              ? { root: mcpTool(entry.root, path, annotations, retired) }
              : {}),
            commands: mcpTools(entry.commands, annotations, retired, path),
          },
        ];
      return [name, isRunnableCommand(entry) ? mcpTool(entry, path, annotations, retired) : entry];
    }),
  );
}

function mcpTool(
  entry: RunnableCommand,
  path: readonly string[],
  annotations: Record<string, Mcp.ToolAnnotations>,
  retired: Record<string, readonly RetiredFlag[]>,
) {
  const name = path.join("_");
  return withMcpGlobal(
    refuseRetired({ ...entry, mcp: { annotations: annotations[name] } }, retired[name] ?? []),
  );
}

/**
 * Keeps each argument a tool took before its flag was retired in the tool's input schema for a
 * release, and refuses it with the CLI's message, so a client still passing one is told what
 * replaces it instead of having it ignored.
 */
function refuseRetired<command extends RunnableCommand>(
  entry: command,
  retired: readonly RetiredFlag[],
) {
  if (retired.length === 0) return entry;
  const key = ({ flag }: RetiredFlag) => flag.slice(2);
  const message = (flag: RetiredFlag, value?: string) =>
    flag.replacement({ given: [], args: [], value }).message;
  const shape = Object.fromEntries(
    retired.map((flag) => [
      key(flag),
      z
        .unknown()
        .optional()
        .describe(`Removed: ${message(flag)}`),
    ]),
  );
  return {
    ...entry,
    options: (entry.options ?? z.object({})).extend(shape),
    run(context: { options: Record<string, unknown>; error: (error: object) => never }) {
      // As on the CLI, an explicit false selects nothing only for a boolean flag.
      const flag = retired.find((flag) => {
        const value = context.options[key(flag)];
        return value !== undefined && (flag.takesValue || value !== false);
      });
      if (!flag) return entry.run(context);
      const { exitCode, retryable } = errorCodes.E_USAGE;
      return context.error({
        code: "E_USAGE",
        message: message(flag, String(context.options[key(flag)])),
        exitCode,
        retryable,
      });
    },
  };
}
