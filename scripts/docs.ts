/**
 * Generates the blocks of README.md and SKILL.md that list every command or MCP tool, from the
 * command modules that `src/cli/commands.ts` lists. A block is the text between
 * `<!-- generated:<name> start -->` and `<!-- generated:<name> end -->`; everything outside the
 * markers is written by hand.
 *
 * `tsx scripts/docs.ts generate` rewrites the blocks; `tsx scripts/docs.ts check` fails when one is
 * stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Cli, Mcp, z } from "incur";

import {
  commandMap,
  isCommandGroup,
  isRunnableCommand,
  type Builtin,
  type CommandDefinition,
  type WalletCommand,
} from "../src/cli/command.js";
import { commands } from "../src/cli/commands.js";
import { builtinFlags } from "../src/cli/completions.js";
import { negatedHelp } from "../src/cli/describe.js";
import { createMcpCommands } from "../src/cli/mcp.js";
import {
  cliGlobalAlias,
  cliGlobals,
  globalAlias,
  globalOptionShape,
} from "../src/schemas/shared.js";

/** The blocks each file holds, by path from the repository root. */
export const docBlocks: Record<string, readonly string[]> = {
  "README.md": ["commands", "mcp-tools"],
  "SKILL.md": ["mcp-tools"],
};

const hints = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;

/** Each block's markdown by name, formatted as `vp fmt` leaves it. */
export function renderBlocks(list: readonly WalletCommand[] = commands): Record<string, string> {
  const cli = Cli.create("tempo wallet");
  for (const { command } of list) if (command) cli.command(command);
  const mounted = commandMap(cli);
  return {
    commands: commandReference(mounted, list),
    "mcp-tools": mcpToolTable(mounted, list),
  };
}

/**
 * Replaces the content of each block in `text` with its entry in `blocks`. Every block in `blocks`
 * must appear exactly once, and `text` may hold no other block.
 */
export function replaceBlocks(text: string, blocks: Readonly<Record<string, string>>) {
  const found = new Set<string>();
  let out = "";
  let last = 0;
  let open: string | undefined;
  for (const match of text.matchAll(/<!-- generated:([\w-]+) (start|end) -->/g)) {
    const [marker] = match;
    const name = match[1]!;
    if (match[2] === "start") {
      if (open) throw new Error(`generated:${open} has no end marker`);
      if (!Object.hasOwn(blocks, name)) throw new Error(`Unknown generated block "${name}"`);
      if (found.has(name)) throw new Error(`generated:${name} appears more than once`);
      out += text.slice(last, match.index + marker.length);
      open = name;
      continue;
    }
    if (open !== name) throw new Error(`generated:${name} end marker has no start marker`);
    out += `\n\n${blocks[name]}\n\n${marker}`;
    last = match.index + marker.length;
    found.add(name);
    open = undefined;
  }
  if (open) throw new Error(`generated:${open} has no end marker`);
  const missing = Object.keys(blocks).filter((name) => !found.has(name));
  if (missing.length > 0) throw new Error(`Missing generated blocks: ${missing.join(", ")}`);
  return out + text.slice(last);
}

/** Regenerates the blocks under `root`, writing them or, with `check`, listing the stale files. */
export function updateDocs(root: string, options: { check: boolean }) {
  const blocks = renderBlocks();
  const stale: string[] = [];
  for (const [file, names] of Object.entries(docBlocks)) {
    const path = join(root, file);
    const text = readFileSync(path, "utf8");
    const next = replaceBlocks(
      text,
      Object.fromEntries(names.map((name) => [name, blocks[name]!])),
    );
    if (next === text) continue;
    stale.push(file);
    if (!options.check) writeFileSync(path, next);
  }
  return stale;
}

/**
 * One line per command and subcommand, in `commands` order, then the global options: the wallet's
 * own, then incur's built-in flags.
 */
function commandReference(mounted: Map<string, unknown>, list: readonly WalletCommand[]) {
  const lines = list.flatMap(({ builtin, command }) => {
    if (command) return entryLines(command.name, mounted.get(command.name));
    return builtin ? builtinLines(builtin, []) : [];
  });
  const globals = [
    ...optionNames(Object.entries(cliGlobals.shape), cliGlobalAlias),
    ...optionNames(Object.entries(globalOptionShape), globalAlias),
    ...builtinFlags.map(({ value }) => `\`${value}\``),
  ];
  return [...lines, "", `Global options: ${series(globals)}.`].join("\n");
}

/** A mounted command, or a group's runnable root and then its subcommands. */
function entryLines(path: string, entry: unknown): string[] {
  if (isCommandGroup(entry))
    return [
      ...(isRunnableCommand(entry.root) ? [runnableLine(path, entry.root)] : []),
      ...[...entry.commands].flatMap(([name, command]) => entryLines(`${path} ${name}`, command)),
    ];
  return isRunnableCommand(entry) ? [runnableLine(path, entry)] : [];
}

/** incur's builtins `mcp` and `skills`: their leaves. */
function builtinLines(builtin: Builtin, prefix: readonly string[]): string[] {
  const path = [...prefix, builtin.name];
  if (builtin.subcommands)
    return builtin.subcommands.flatMap((command) => builtinLines(command, path));
  return [runnableLine(path.join(" "), builtin)];
}

function runnableLine(path: string, command: CommandDefinition) {
  const args = Object.entries(command.args?.shape ?? {}).map(([name, field]) => {
    const values = enumValues(field as z.ZodType);
    const label = values ? values.join("|") : name;
    return (field as z.ZodType)._zod.optout === "optional" ? `[${label}]` : `<${label}>`;
  });
  // The global options are listed once, after every command.
  const options = Object.entries(command.options?.shape ?? {}).filter(
    ([name]) => !Object.hasOwn(globalOptionShape, name),
  );
  return line([path, ...args].join(" "), command.description, optionNames(options, command.alias));
}

function line(usage: string, description: string | undefined, options: readonly string[]) {
  const about = description ? ` ${description.replace(/[^.!?]$/, "$&.")}` : "";
  const text = `- \`${usage}\`:${about}`;
  return options.length > 0 ? `${text} Options: ${options.join(", ")}.` : text;
}

/**
 * Each option as typed on the command line. A boolean that defaults to true is listed as its
 * `--no-<name>` form only; any other boolean adds `--no-<name>` when it registers help for that
 * form, as `--describe` does.
 */
function optionNames(
  options: readonly [string, unknown][],
  alias: Record<string, string | undefined> = {},
) {
  return options.flatMap(([name, field]) => {
    const flag = `--${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
    const short = alias[name] && `-${alias[name]}`;
    const schema = field as z.ZodType;
    if (!(unwrap(schema) instanceof z.ZodBoolean)) return [withShort(flag, short)];
    const negated = `--no-${flag.slice(2)}`;
    if (schema instanceof z.ZodDefault && schema.def.defaultValue === true)
      return [withShort(negated, short)];
    const documented = negatedHelp(schema) !== undefined;
    return [withShort(flag, short), ...(documented ? [`\`${negated}\``] : [])];
  });
}

function withShort(long: string, short: string | undefined) {
  return short ? `\`${long}\` (\`${short}\`)` : `\`${long}\``;
}

function enumValues(field: z.ZodType): string[] | undefined {
  const schema = unwrap(field);
  return schema instanceof z.ZodEnum ? schema.options.map(String) : undefined;
}

/** The schema inside any optional and default wrappers. */
function unwrap(field: z.ZodType): z.ZodType {
  return field instanceof z.ZodOptional || field instanceof z.ZodDefault
    ? unwrap(field.unwrap() as z.ZodType)
    : field;
}

/**
 * The tools `tempo wallet --mcp` serves, with each annotation hint. incur's own tool walk names
 * them and orders them as `tools/list` does.
 */
function mcpToolTable(mounted: Map<string, unknown>, list: readonly WalletCommand[]) {
  const rows = Mcp.collectTools(createMcpCommands(mounted, list), []).map(
    ({ name, annotations }) => [
      `\`${name}\``,
      ...hints.map((hint) => {
        const value = annotations?.[hint];
        if (value === undefined)
          throw new Error(
            `MCP tool ${name} declares no ${hint}; set it in its module's annotations`,
          );
        return String(value);
      }),
    ],
  );
  return table(["Tool", ...hints.map((hint) => `\`${hint}\``)], rows);
}

/** A markdown table with each column padded to its widest cell, as `vp fmt` pads it. */
function table(header: readonly string[], rows: readonly (readonly string[])[]) {
  const widths = header.map((cell, index) =>
    Math.max(3, cell.length, ...rows.map((row) => row[index]!.length)),
  );
  const format = (row: readonly string[]) =>
    `| ${row.map((cell, index) => cell.padEnd(widths[index]!)).join(" | ")} |`;
  return [
    format(header),
    format(widths.map((width) => "-".repeat(width))),
    ...rows.map(format),
  ].join("\n");
}

function series(items: readonly string[]) {
  if (items.length < 3) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

if (resolve(process.argv[1] ?? "") === resolve(import.meta.filename)) {
  const mode = process.argv[2];
  if (mode !== "generate" && mode !== "check") {
    console.error("Usage: tsx scripts/docs.ts <generate|check>");
    process.exit(1);
  }
  const stale = updateDocs(resolve(import.meta.dirname, ".."), { check: mode === "check" });
  if (mode === "check" && stale.length > 0) {
    console.error(
      `Generated docs are out of date in ${stale.join(" and ")}. Run \`pnpm docs:generate\` and commit the result.`,
    );
    process.exit(1);
  }
  if (mode === "generate")
    console.log(stale.length > 0 ? `Updated ${stale.join(" and ")}` : "Docs are up to date");
}
