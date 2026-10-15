import { commandTokens } from "./argv.js";
import type { WalletCommand } from "./command.js";
import { flag, option } from "./describe.js";

/** incur's builtin `mcp`, which incur mounts; `--describe` lists it. */
export const mcp: WalletCommand = {
  describe: {
    name: "mcp",
    about: "Register as MCP server",
    subcommands: [
      {
        name: "add",
        about: "Register as MCP server",
        args: [
          option("agent", "--agent", "Target a specific agent", { valueName: "AGENT" }),
          option("command", "--command", "Override the command agents will run", {
            short: "-c",
            valueName: "COMMAND",
          }),
          flag("no_global", "--no-global", "Install to project instead of globally"),
        ],
      },
    ],
  },
};

/** incur's builtin `skills`, which incur mounts; `--describe` lists it. */
export const skills: WalletCommand = {
  describe: {
    name: "skills",
    about: "Sync skill files to agents",
    aliases: ["skill"],
    subcommands: [
      {
        name: "add",
        about: "Sync skill files to agents",
        args: [
          option("depth", "--depth", "Grouping depth for skill files", {
            valueName: "DEPTH",
          }),
          flag("no_global", "--no-global", "Install to project instead of globally"),
        ],
      },
      { name: "list", about: "List skills", aliases: ["ls"] },
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
