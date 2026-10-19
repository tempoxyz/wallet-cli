import { z } from "incur";

import { servicesOptions } from "../schemas/services.js";
import { globalAlias } from "../schemas/shared.js";
import { commandError, errorCodes } from "../shared/errors.js";
import { shellQuote } from "../shared/next.js";
import { commandMap, type WalletCommand } from "./command.js";

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
    else if (takesValue(arg) && next !== undefined) parts.push({ flag: [arg, args[++index]!] });
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

/**
 * A flag a command does not take, though an earlier form of it did, such as `--mach` on `send`,
 * which `transfer` takes. `retireFlags` strips it from argv so incur does not report an unknown
 * flag, and the run fails with `E_USAGE` naming what replaces it.
 */
export type RetiredFlag = {
  flag: `--${string}`;
  /**
   * Whether the flag takes a value, which is stripped with it. Otherwise it is a boolean: an
   * explicit false (`--flag=false`, `--flag false`, or `--no-flag`) selects nothing, so it is
   * stripped without an error.
   */
  takesValue?: boolean | undefined;
  /** Flags under which the command still takes it, as `--credits` keeps the credits `--to`. */
  unless?: readonly `--${string}`[] | undefined;
  /** Flags under which alone it is retired, as `--amount-cents` is with `--mach`. */
  when?: readonly `--${string}`[] | undefined;
  /**
   * Whether the command's MCP tool took it as an argument. The tool keeps that argument for a
   * release and refuses it with the same message, so a client passing it is not silently ignored.
   */
  mcp?: boolean | undefined;
  /**
   * The error's message and, when it can be built from the run's argv, the command to run
   * instead, from its command name on. `given` are the tokens after the command name as given,
   * `args` the same without the flag, and `value` is the flag's value.
   */
  replacement: (retired: { given: string[]; args: string[]; value: string | undefined }) => {
    message: string;
    argv?: string[] | undefined;
  };
};

/**
 * Strips the `retiredFlags` of the command `args` names, each with its value, before incur parses
 * `args`. A group's flags are its own command's, not its subcommands'. `error` is the usage error
 * for the first one set, which the CLI returns from middleware before the command parses its
 * options or runs, so nothing is sent. Its `cta` is the replacement command, keeping the tokens
 * before the command name; with several set, each replaces only itself, so there is none. Stops
 * at `--`.
 */
export function retireFlags(args: readonly string[], commands: readonly WalletCommand[]) {
  const index = firstCommandIndex(args);
  const name = index === undefined ? undefined : args[index];
  const command = commands.find((entry) => entry.command?.name === name);
  // incur completes the words after `--` by their positions, so in completion they must not move.
  if (index === undefined || !command?.command || !command.retiredFlags || process.env.COMPLETE)
    return { args: [...args] };

  const before = args.slice(0, index);
  const after = args.slice(index + 1);
  const options = after.includes("--") ? after.slice(0, after.indexOf("--")) : after;
  const retired = command.retiredFlags.filter(
    ({ unless = [], when }) =>
      !unless.some((flag) => flagSet(options, flag)) &&
      (when === undefined || when.some((flag) => flagSet(options, flag))),
  );
  const rest: string[] = [];
  let stripped = false;
  const found: { flag: RetiredFlag; value: string | undefined }[] = [];
  for (let i = 0; i < after.length; i++) {
    const arg = after[i]!;
    if (arg === "--") {
      rest.push(...after.slice(i));
      break;
    }
    const flag = retired.find(
      (entry) =>
        arg === entry.flag ||
        arg.startsWith(`${entry.flag}=`) ||
        (!entry.takesValue && arg === `--no-${entry.flag.slice(2)}`),
    );
    if (!flag) {
      rest.push(arg);
      continue;
    }
    stripped = true;
    const bound = arg.startsWith(`${flag.flag}=`) ? arg.slice(flag.flag.length + 1) : undefined;
    if (flag.takesValue) {
      const value = bound ?? after[++i];
      found.push({ flag, value });
      continue;
    }
    const literal = bound === undefined && isBooleanLiteral(after[i + 1]) ? after[++i] : bound;
    if (arg !== `--no-${flag.flag.slice(2)}` && literal !== "false")
      found.push({ flag, value: literal });
  }
  // Read after stripping, so a retired flag's value, as in `fund --claim status`, is no subcommand.
  const [subcommand] = commandTokens(rest);
  if (subcommand !== undefined && commandMap(command.command).has(subcommand))
    return { args: [...args] };
  const [first] = found;
  if (!first) return { args: stripped ? [...before, name!, ...rest] : [...args] };

  const replacement = first.flag.replacement({
    given: [...after],
    args: rest,
    value: first.value,
  });
  const { message } = replacement;
  // A value that reads as a flag, as in `--claim --mcp`, was most likely not meant as one.
  const flagValue = first.flag.takesValue && first.value?.startsWith("-");
  const argv = found.length === 1 && !flagValue ? replacement.argv : undefined;
  const { exitCode, retryable } = errorCodes.E_USAGE;
  return {
    args: [...before, name!, ...rest],
    error: argv
      ? commandError(
          "E_USAGE",
          message,
          ["tempo", "wallet", ...before, ...argv].map(shellQuote).join(" "),
        )
      : { code: "E_USAGE", message, exitCode, retryable },
  };
}

/** Whether `args` sets boolean `flag`: alone, or as anything but an explicit false. */
export function flagSet(args: readonly string[], flag: string) {
  return args.some(
    (arg, index) =>
      (arg === flag && args[index + 1] !== "false") ||
      (arg.startsWith(`${flag}=`) && arg !== `${flag}=false`),
  );
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
  return [
    "--format",
    "--filter-output",
    "--token-limit",
    "--token-offset",
    "--network",
    "-n",
  ].includes(arg);
}

function hasFormat(args: readonly string[]) {
  return args.some((arg) => arg === "--format" || arg.startsWith("--format="));
}

function isBooleanLiteral(value: string | undefined) {
  return value === "true" || value === "false";
}

/** The command and positional tokens, skipping flags and the values `takesValue` flags take. */
export function commandTokens(args: readonly string[]) {
  return operandIndexes(args).map((index) => args[index]!);
}

/** The indexes of the command and positional tokens of `args`; see `commandTokens`. */
export function operandIndexes(args: readonly string[]) {
  const indexes: number[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    if (takesValue(arg)) {
      index++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    indexes.push(index);
  }
  return indexes;
}
