import { Cli, z } from "incur";

import {
  cliGlobalAlias,
  cliGlobals,
  describeMeta,
  globalAlias,
  globalOptionShape,
} from "../schemas/shared.js";
import {
  commandMap,
  isCommandGroup,
  type Builtin,
  type CommandDefinition,
  type WalletCommand,
} from "./command.js";

/** A command's `--describe` entry, in the shape the Rust wallet printed from its clap commands. */
export type Describe = {
  name: string;
  about: string;
  aliases?: string[] | undefined;
  args?: DescribeArg[] | undefined;
  subcommands?: Describe[] | undefined;
};

type DescribeArg =
  | ReturnType<typeof positional>
  | ReturnType<typeof flag>
  | ReturnType<typeof option>;

/**
 * `tempo wallet --describe`, generated from `cli` as mounted: the global options, then each
 * command in `commands` order, with its args and options from its schemas. The options every
 * command takes are listed once, as global; a `hidden` command is left out.
 */
export function describeCli(
  cli: Cli.Cli<any, any, any, any, any>,
  commands: readonly WalletCommand[],
): Describe {
  const mounted = commandMap(cli);
  return {
    name: cli.name,
    about: cli.description ?? "",
    args: [
      ...optionArgs(cliGlobals.shape, cliGlobalAlias, true),
      ...optionArgs(globalOptionShape, globalAlias, true),
    ],
    subcommands: commands.flatMap(({ builtin, command, hidden }) => {
      if (hidden) return [];
      if (command) return [describeEntry(command.name, mounted.get(command.name), undefined)];
      return builtin ? [describeBuiltin(builtin)] : [];
    }),
  };
}

/** Help for the `--no-<name>` form of a boolean option, when it documents one. */
export function negatedHelp(field: z.ZodType) {
  return metadata(field).negated;
}

/** An incur command map entry: a command, or a group with its subcommands and runnable root. */
function describeEntry(name: string, entry: unknown, aliases: string[] | undefined): Describe {
  if (!isCommandGroup(entry)) return node(name, entry as CommandDefinition, aliases, []);
  const { description } = entry as { description?: string | undefined };
  const root = entry.root as CommandDefinition | undefined;
  return node(name, { ...root, description }, aliases, describeCommands(entry.commands));
}

/** A group's subcommands in mount order, each with the aliases incur mounted for it. */
function describeCommands(commands: Map<string, unknown>) {
  const aliases = new Map<string, string[]>();
  for (const [name, entry] of commands)
    if (isAlias(entry)) aliases.set(entry.target, [...(aliases.get(entry.target) ?? []), name]);
  return [...commands].flatMap(([name, entry]) =>
    isAlias(entry) ? [] : [describeEntry(name, entry, aliases.get(name))],
  );
}

function describeBuiltin(builtin: Builtin): Describe {
  return node(
    builtin.name,
    builtin,
    builtin.aliases,
    (builtin.subcommands ?? []).map(describeBuiltin),
  );
}

function node(
  name: string,
  definition: CommandDefinition,
  aliases: string[] | undefined,
  subcommands: Describe[],
): Describe {
  const args = [
    ...Object.entries(definition.args?.shape ?? {}).map(([key, field]) =>
      positional(metadata(field).name ?? snakeCase(key), help(field)),
    ),
    ...optionArgs(
      Object.fromEntries(
        Object.entries(definition.options?.shape ?? {}).filter(
          ([key]) => !Object.hasOwn(globalOptionShape, key),
        ),
      ),
      definition.alias,
    ),
  ];
  return {
    name,
    about: definition.description ?? "",
    ...(aliases?.length ? { aliases } : {}),
    ...(args.length > 0 ? { args } : {}),
    ...(subcommands.length > 0 ? { subcommands } : {}),
  };
}

/**
 * Each option as typed on the command line: a boolean as a flag, any other as an option taking
 * a value. A boolean that defaults to true is listed as its `--no-<name>` form only; any other
 * boolean adds that form when it registers help for it.
 */
function optionArgs(
  shape: Record<string, z.ZodType>,
  alias: Record<string, string | undefined> = {},
  global = false,
) {
  return Object.entries(shape).flatMap(([key, field]): DescribeArg[] => {
    const { name = snakeCase(key), negated, valueName } = metadata(field);
    const long = `--${kebabCase(key)}`;
    const short = alias[key] && `-${alias[key]}`;
    if (!(unwrap(field) instanceof z.ZodBoolean))
      return [option(name, long, help(field), { global, short, valueName })];
    const negation = flag(`no_${name}`, `--no-${long.slice(2)}`, negated ?? help(field), {
      global,
    });
    if (field instanceof z.ZodDefault && field.def.defaultValue === true) return [negation];
    return [
      flag(name, long, help(field), { global, short }),
      ...(negated === undefined ? [] : [negation]),
    ];
  });
}

/**
 * The description of a field or of the schema its optional or default wraps, as its JSON Schema
 * for `--schema` and MCP reads it: `transfer` takes the arguments of `send`, made optional.
 */
function help(field: z.ZodType): string | undefined {
  const inner = unwrapOnce(field);
  return field.description ?? (inner ? help(inner) : undefined);
}

/** The metadata registered on an option or on the schema its optional or default wraps. */
function metadata(field: z.ZodType): NonNullable<ReturnType<typeof describeMeta.get>> {
  const own = describeMeta.get(field);
  if (own) return own;
  const inner = unwrapOnce(field);
  return inner ? metadata(inner) : {};
}

function unwrap(field: z.ZodType): z.ZodType {
  const inner = unwrapOnce(field);
  return inner ? unwrap(inner) : field;
}

function unwrapOnce(field: z.ZodType) {
  return field instanceof z.ZodOptional || field instanceof z.ZodDefault
    ? (field.unwrap() as z.ZodType)
    : undefined;
}

function isAlias(entry: unknown): entry is { _alias: true; target: string } {
  return typeof entry === "object" && entry !== null && "_alias" in entry && "target" in entry;
}

/** incur's flag spelling of an option key: `maxSpend` is `--max-spend`. */
function kebabCase(key: string) {
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/** The clap argument id the Rust wallet printed: `max-spend` and `maxSpend` are `max_spend`. */
function snakeCase(key: string) {
  return kebabCase(key).replaceAll("-", "_");
}

function positional(name: string, help: string | undefined) {
  return { name, help, type: "positional" };
}

function flag(
  name: string,
  long: string,
  help: string | undefined,
  options: { global?: boolean | undefined; short?: string | undefined } = {},
) {
  return {
    ...option(name, long, help, options),
    possible_values: ["true", "false"],
  };
}

function option(
  name: string,
  long: string,
  help: string | undefined,
  options: {
    global?: boolean | undefined;
    short?: string | undefined;
    valueName?: string | undefined;
  } = {},
) {
  return {
    name,
    ...(options.short ? { short: options.short } : {}),
    long,
    help,
    ...(options.global ? { global: true } : {}),
    type: "option",
    value_name: options.valueName ?? name.toUpperCase(),
  };
}
