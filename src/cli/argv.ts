import { z } from "incur";

import { servicesOptions } from "../schemas/services.js";
import { globalAlias } from "../schemas/shared.js";

/** `help [command...]` is shorthand for `[command...] --help`. */
export function expandHelp(args: string[]) {
  const index = firstCommandIndex(args);
  if (index === undefined || args[index] !== "help") return args;
  return [...args.slice(0, index), ...args.slice(index + 1), "--help"];
}

/**
 * Normalizes `services` argv before incur reads it. `--json-output` (`-j`) and `--toon-output`
 * (`-t`) become `--format json` or `--format toon` after the command name, unless `--format` is
 * already set.
 *
 * Each deprecated form becomes the subcommand that replaces it, noting that on stderr on a
 * terminal: `services <id>` is `services show <id>`, and `services [list] --search <query>` is
 * `services search <query>`. An id still wins over `--search`. A subcommand name is never an id,
 * so a service named `list`, `search`, or `show` is only reachable as `services show <id>`. The
 * subcommand moves to just after `services`, where incur looks for it.
 *
 * incur runs a group's own command for a token that names no subcommand, but not for one that
 * looks like a typo of one, such as `edgar-search` or `--search=ai`, so the rewrite is done here.
 * incur reads each token as one flag or one positional, so the rewrite also reads `true` or
 * `false` after a boolean flag as its value, everything after `--` as positionals, and the words
 * of an unquoted `services search` query as one query. It never turns a value into a token that
 * starts with `-`, which incur or this CLI would read as a flag such as `--mcp`.
 */
export function normalizeServicesArgs(args: readonly string[]) {
  const normalized = normalizeServicesOutputAliases(args);
  const commandIndex = firstCommandIndex(normalized);
  if (commandIndex === undefined || normalized[commandIndex] !== "services") return normalized;
  // incur completes the words after `--` by their positions, so in completion they must not move.
  if (process.env.COMPLETE) return normalized;

  const head = normalized.slice(0, commandIndex + 1);
  const parts = servicesParts(normalized.slice(commandIndex + 1));
  const operands = parts.flatMap((part) => (part.operand === undefined ? [] : [part.operand]));
  const search = parts.findLast((part) => part.search !== undefined)?.search;
  const flags = parts.flatMap((part) => part.flag ?? []);
  const command = (subcommand: string, value: string | undefined) => [
    ...head,
    subcommand,
    ...(value === undefined ? [] : [value]),
    ...flags,
  ];

  const [name, value] = operands;
  if (name !== undefined && !servicesSubcommands.includes(name)) {
    deprecatedServicesForm(normalized, "services <id>", "services show <id>");
    return command("show", serviceId(name));
  }
  if (search !== undefined && (name === undefined || name === "list")) {
    deprecatedServicesForm(normalized, "services --search <query>", "services search <query>");
    return command("search", searchQuery(search));
  }
  if (name === "search")
    return command(
      "search",
      value === undefined ? undefined : searchQuery(operands.slice(1).join(" ")),
    );
  if (name === "show") return command("show", serviceId(value));
  if (name === "list") return command("list", undefined);
  return [...head, ...flags];
}

/** The `services` subcommands, which a deprecated `services <id>` cannot name. */
export const servicesSubcommands = ["list", "search", "show"];

/** Search ignores dashes, so a query's leading ones are dropped rather than read as a flag. */
function searchQuery(query: string) {
  return query.replace(/^-+/, "");
}

/** No service id starts with `-`, and incur would read one as a flag, so it is left out. */
function serviceId(id: string | undefined) {
  return id?.startsWith("-") ? undefined : id;
}

/** The boolean options of `services` and its subcommands, with their short aliases. */
const servicesBooleanFlags = new Set(
  Object.entries(servicesOptions.shape).flatMap(([name, field]) => {
    if (!(field.unwrap() instanceof z.ZodBoolean)) return [];
    const short = globalAlias[name as keyof typeof globalAlias];
    return [`--${name}`, ...(short ? [`-${short}`] : [])];
  }),
);

/** A flag with any value, a positional operand, or the deprecated `--search` with its query. */
type ServicesPart = { flag?: string[]; operand?: string; search?: string };

function servicesParts(args: readonly string[]) {
  const parts: ServicesPart[] = [];
  let operandsOnly = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const next = args[index + 1];
    // An empty token names nothing; `--search ""` keeps its value below.
    if (arg === "") continue;
    if (operandsOnly) parts.push({ operand: arg });
    else if (arg === "--") operandsOnly = true;
    else if (arg.startsWith("--search=")) parts.push({ search: arg.slice("--search=".length) });
    // Like the option it was, `--search` takes the next token even when it is empty or a flag.
    else if (arg === "--search" && next !== undefined) parts.push({ search: args[++index]! });
    // An absent boolean option is false.
    else if (servicesBooleanFlags.has(arg) && isBooleanLiteral(next))
      parts.push({ flag: args[++index] === "true" ? [arg] : [] });
    else if ((takesValue(arg) || arg === "--filter-output") && next !== undefined)
      parts.push({ flag: [arg, args[++index]!] });
    else if (arg.startsWith("-")) parts.push({ flag: [arg] });
    else parts.push({ operand: arg });
  }
  return parts;
}

/**
 * Notes a deprecated `services` form on stderr. Only on a terminal: incur treats a run with
 * stdout piped or an explicit format as an agent's, whose output stays unchanged.
 */
function deprecatedServicesForm(args: readonly string[], form: string, replacement: string) {
  if (process.stdout.isTTY !== true || hasFormat(args) || args.includes("--json")) return;
  console.error(
    `Warning: 'tempo wallet ${form}' is deprecated; use 'tempo wallet ${replacement}'.`,
  );
}

function normalizeServicesOutputAliases(args: readonly string[]) {
  const commandIndex = firstCommandIndex(args);
  if (commandIndex === undefined || args[commandIndex] !== "services") return [...args];

  const normalized: string[] = [];
  let format: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json-output" || arg === "-j") {
      format ??= "json";
      if (isBooleanLiteral(args[index + 1])) index++;
      continue;
    }
    if (arg === "--toon-output" || arg === "-t") {
      format ??= "toon";
      if (isBooleanLiteral(args[index + 1])) index++;
      continue;
    }
    // An empty token can be `--search ""`; `servicesParts` drops any other.
    if (arg !== undefined) normalized.push(arg);
  }

  if (!format || hasFormat(normalized)) return normalized;

  const normalizedCommandIndex = firstCommandIndex(normalized);
  if (normalizedCommandIndex === undefined) return normalized;
  return [
    ...normalized.slice(0, normalizedCommandIndex + 1),
    "--format",
    format,
    ...normalized.slice(normalizedCommandIndex + 1),
  ];
}

/** The index of the first command token, skipping flags and the values `takesValue` flags take. */
export function firstCommandIndex(args: readonly string[]) {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    if (takesValue(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("--format=") || arg.startsWith("--token-limit=")) continue;
    if (arg.startsWith("-")) continue;
    return index;
  }
  return undefined;
}

/** Flags whose next token is their value rather than a command name. */
function takesValue(arg: string) {
  return ["--format", "--token-limit", "--token-offset", "--network", "-n"].includes(arg);
}

function hasFormat(args: readonly string[]) {
  return args.some((arg) => arg === "--format" || arg.startsWith("--format="));
}

function isBooleanLiteral(value: string | undefined) {
  return value === "true" || value === "false";
}

/** The command and positional tokens, skipping flags and the values `takesValue` flags take. */
export function commandTokens(args: readonly string[]) {
  const tokens: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg || arg === "--schema" || arg === "--help" || arg === "--llms" || arg === "--llms-full")
      continue;
    if (takesValue(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("--format=") || arg.startsWith("--token-limit=")) continue;
    if (arg.startsWith("-")) continue;
    tokens.push(arg);
  }
  return tokens;
}
