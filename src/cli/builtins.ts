import { z } from "incur";

import { commandTokens } from "./argv.js";
import type { WalletCommand } from "./command.js";

// incur defines its builtins in an internal module it does not export, so the ones wallet
// documents are restated here in the same shape: what `--describe`, completions, and the README
// list of them.

const noGlobal = z.boolean().optional().describe("Install to project instead of globally");

/** incur's builtin `mcp`, which incur mounts. */
export const mcp: WalletCommand = {
  builtin: {
    name: "mcp",
    description: "Register as MCP server",
    subcommands: [
      {
        name: "add",
        description: "Register as MCP server",
        options: z.object({
          agent: z.string().optional().describe("Target a specific agent"),
          command: z.string().optional().describe("Override the command agents will run"),
          noGlobal,
        }),
        alias: { command: "c" },
      },
    ],
  },
};

/** incur's builtin `skills`, which incur mounts. */
export const skills: WalletCommand = {
  builtin: {
    name: "skills",
    aliases: ["skill"],
    description: "Sync skill files to agents",
    subcommands: [
      {
        name: "add",
        description: "Sync skill files to agents",
        options: z.object({
          depth: z.number().optional().describe("Grouping depth for skill files"),
          noGlobal,
        }),
      },
      { name: "list", aliases: ["ls"], description: "List skills" },
    ],
  },
};

/** Prints `--schema` for incur's builtin `mcp add`, `skills add`, and `skills list`. */
export function handleBuiltinSchema(args: readonly string[]) {
  if (!args.includes("--schema")) return false;

  const tokens = commandTokens(args);
  const [command, subcommand] = tokens;

  if (command === "mcp" && subcommand === "add") {
    printSchema({
      options: objectSchema({
        agent: stringSchema("Target a specific agent"),
        command: stringSchema("Override the command agents will run"),
        "no-global": booleanSchema("Install to project instead of globally"),
      }),
      output: objectSchema({
        agents: arraySchema(stringSchema()),
        command: stringSchema(),
        name: stringSchema(),
      }),
    });
    return true;
  }

  if (command === "skills" || command === "skill") {
    if (subcommand === "add") {
      printSchema({
        options: objectSchema({
          depth: numberSchema("Grouping depth for skill files"),
          "no-global": booleanSchema("Install to project instead of globally"),
        }),
        output: objectSchema({
          skills: arraySchema(stringSchema()),
        }),
      });
      return true;
    }

    if (subcommand === "list" || subcommand === "ls") {
      printSchema({
        output: arraySchema(
          objectSchema({
            description: stringSchema(),
            installed: booleanSchema(),
            name: stringSchema(),
          }),
        ),
      });
      return true;
    }
  }

  return false;
}

function printSchema(schema: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
}

function objectSchema(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    additionalProperties: false,
  };
}

function stringSchema(description?: string | undefined) {
  return {
    ...(description ? { description } : {}),
    type: "string",
  };
}

function numberSchema(description?: string | undefined) {
  return {
    ...(description ? { description } : {}),
    type: "number",
  };
}

function booleanSchema(description?: string | undefined) {
  return {
    ...(description ? { description } : {}),
    type: "boolean",
  };
}

function arraySchema(items: Record<string, unknown>) {
  return {
    type: "array",
    items,
  };
}
