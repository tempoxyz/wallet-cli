import { Cli, Parser, z } from "incur";
import { describe, expect, it } from "vitest";

import {
  commandMap,
  isCommandGroup,
  isRunnableCommand,
  type CommandDefinition,
} from "../src/cli/command.js";
import { commands } from "../src/cli/commands.js";
import { describeCli, type Describe } from "../src/cli/describe.js";
import { cliGlobalAlias, cliGlobals, globalOptionShape } from "../src/schemas/shared.js";

const cli = Cli.create("tempo wallet", {
  description: "Wallet identity and custody operations",
  globals: cliGlobals,
  globalAlias: cliGlobalAlias,
});
for (const { command } of commands) if (command) cli.command(command);
const manifest = describeCli(cli, commands);

type Arg = NonNullable<Describe["args"]>[number] & {
  long?: string;
  possible_values?: string[];
  value_name?: string;
};

const hidden = new Set(commands.flatMap(({ command, hidden }) => (hidden ? [command?.name] : [])));

/** Every command incur mounted that runs, by path: each command, and each group's own root. */
function runnable(entries: Map<string, unknown>, prefix: string[] = []) {
  return [...entries].flatMap(
    ([name, entry]): { path: string[]; definition: CommandDefinition }[] => {
      const path = [...prefix, name];
      if (prefix.length === 0 && hidden.has(name)) return [];
      if (isCommandGroup(entry))
        return [
          ...(isRunnableCommand(entry.root) ? [{ path, definition: entry.root }] : []),
          ...runnable(entry.commands, path),
        ];
      return isRunnableCommand(entry) ? [{ path, definition: entry }] : [];
    },
  );
}

const cases = runnable(commandMap(cli)).map(({ path, definition }) => ({
  command: path.join(" "),
  definition,
  entry: path.reduce<Describe | undefined>(
    (parent, name) => parent?.subcommands?.find((child) => child.name === name),
    manifest,
  ),
}));

const flagName = (key: string) => key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
const argName = (key: string) => flagName(key).replaceAll("-", "_");
const ownOptions = (definition: CommandDefinition) =>
  Object.keys(definition.options?.shape ?? {}).filter(
    (key) => !Object.hasOwn(globalOptionShape, key),
  );

describe("--describe", () => {
  it("lists every command in registry order, leaving out hidden ones", () => {
    expect(manifest.subcommands?.map((command) => command.name)).toEqual(
      commands.flatMap(({ builtin, command, hidden }) =>
        hidden ? [] : [command?.name ?? builtin!.name],
      ),
    );
    expect(manifest.subcommands?.map((command) => command.name)).not.toContain("completions");
  });

  it("lists the global options once, at the top", () => {
    expect(manifest.args?.map(({ name }) => name)).toEqual(
      [...Object.keys(cliGlobals.shape), ...Object.keys(globalOptionShape)].map(argName),
    );
    expect(manifest.args?.every((arg) => "global" in arg && arg.global)).toBe(true);
  });

  it.each(cases)("describes `$command` from its schemas", ({ definition, entry }) => {
    expect(entry).toBeDefined();
    expect(entry!.about).toBe(definition.description);
    const args = (entry!.args ?? []) as Arg[];

    // Its positionals, in order.
    expect(args.filter(({ type }) => type === "positional").map(({ name }) => name)).toEqual(
      Object.keys(definition.args?.shape ?? {}).map(argName),
    );

    // Each option, and nothing else: every option the schema takes is described, and every
    // described option is one the schema takes.
    const options = args.filter(({ type }) => type === "option");
    const described = options.map(({ long }) => long!.replace(/^--(no-)?/, ""));
    expect([...new Set(described)].sort()).toEqual(ownOptions(definition).map(flagName).sort());

    // Each name once, and help for each.
    expect(new Set(args.map(({ name }) => name)).size).toBe(args.length);
    for (const arg of args) expect(arg.help).toMatch(/\S/);
  });

  it.each(cases.filter(({ definition }) => ownOptions(definition).length > 0))(
    "describes options of `$command` the parser accepts",
    ({ definition, entry }) => {
      const schema = definition.options!.partial();
      for (const { long, possible_values: values } of (entry!.args ?? []) as Arg[]) {
        if (!long) continue;
        const key = ownOptions(definition).find(
          (name) => long === `--${flagName(name)}` || long === `--no-${flagName(name)}`,
        )!;
        const argv = values ? [long] : [long, "1"];
        const alias = definition.alias as Record<string, string> | undefined;
        const { options } = Parser.parse(argv, { options: schema, alias });
        expect(options).toHaveProperty(key, values ? !long.startsWith("--no-") : expect.anything());
        // A flag is a boolean; an option takes a value.
        expect(Boolean(values)).toBe(isBoolean(definition.options!.shape[key] as z.ZodType));
      }
    },
  );

  // The hints are registered with `describeMeta`, not `.meta()`, so the JSON Schema that
  // `--schema`, `--llms-full`, and MCP tools print stays as it was.
  it.each(cases)("keeps `$command`'s describe hints out of its JSON Schema", ({ definition }) => {
    for (const schema of [definition.args, definition.options])
      if (schema)
        expect(schemaKeywords(z.toJSONSchema(schema))).not.toContain(
          expect.stringMatching(/^(name|valueName|negated)$/),
        );
  });

  it("keeps the Rust wallet's entry and argument fields", () => {
    const entryKeys = new Set(["name", "about", "aliases", "args", "subcommands"]);
    const argKeys = new Set([
      "name",
      "short",
      "long",
      "help",
      "global",
      "type",
      "value_name",
      "possible_values",
    ]);
    const visit = (entry: Describe): void => {
      for (const key of Object.keys(entry)) expect(entryKeys).toContain(key);
      for (const arg of (entry.args ?? []) as Arg[]) {
        for (const key of Object.keys(arg)) expect(argKeys).toContain(key);
        if (arg.type === "positional") expect(Object.keys(arg)).toEqual(["name", "help", "type"]);
        else {
          expect(arg.type).toBe("option");
          expect(arg.value_name).toMatch(/^[A-Z_]+$/);
          if (arg.possible_values) expect(arg.possible_values).toEqual(["true", "false"]);
        }
      }
      for (const subcommand of entry.subcommands ?? []) visit(subcommand);
    };
    visit(manifest);
  });
});

/** Every keyword of a JSON Schema, leaving out the property names under `properties`. */
function schemaKeywords(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(schemaKeywords);
  if (typeof schema !== "object" || schema === null) return [];
  return Object.entries(schema).flatMap(([key, value]) =>
    key === "properties"
      ? Object.values(value as object).flatMap(schemaKeywords)
      : [key, ...schemaKeywords(value)],
  );
}

function isBoolean(field: z.ZodType): boolean {
  if (field instanceof z.ZodOptional || field instanceof z.ZodDefault)
    return isBoolean(field.unwrap() as z.ZodType);
  return field instanceof z.ZodBoolean;
}
