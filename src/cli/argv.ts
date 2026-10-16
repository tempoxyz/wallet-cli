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
 */
export function normalizeServicesArgs(args: readonly string[]) {
  const normalized = normalizeServicesOutputAliases(args);
  const commandIndex = firstCommandIndex(normalized);
  if (commandIndex === undefined || normalized[commandIndex] !== "services") return normalized;
  // Shell completion passes the words after `--`, and their positions must not move.
  if (normalized.includes("--")) return normalized;

  const head = normalized.slice(0, commandIndex + 1);
  const parts = servicesParts(normalized.slice(commandIndex + 1));
  const first = parts.find((part) => part.operand !== undefined);
  const name = first?.operand;
  const search = parts.findLast((part) => part.search !== undefined)?.search;
  const rest = (drop: (part: ServicesPart) => boolean) =>
    parts.flatMap((part) => (drop(part) ? [] : part.tokens));

  if (name !== undefined && !servicesSubcommands.includes(name)) {
    deprecatedServicesForm(normalized, "services <id>", "services show <id>");
    return [...head, "show", ...rest((part) => part.search !== undefined)];
  }
  if (search !== undefined && (name === undefined || name === "list")) {
    deprecatedServicesForm(normalized, "services --search <query>", "services search <query>");
    return [
      ...head,
      "search",
      search,
      ...rest((part) => part === first || part.search !== undefined),
    ];
  }
  return name === undefined ? normalized : [...head, name, ...rest((part) => part === first)];
}

/** The `services` subcommands, which a deprecated `services <id>` cannot name. */
export const servicesSubcommands = ["list", "search", "show"];

/** A flag with its value, a positional operand, or the deprecated `--search` with its query. */
type ServicesPart = { tokens: string[]; operand?: string; search?: string };

function servicesParts(args: readonly string[]) {
  const parts: ServicesPart[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const next = args[index + 1];
    if (arg.startsWith("--search="))
      parts.push({ tokens: [arg], search: arg.slice("--search=".length) });
    else if (arg === "--search" && next !== undefined)
      parts.push({ tokens: [arg, args[++index]!], search: next });
    else if ((takesValue(arg) || arg === "--filter-output") && next !== undefined)
      parts.push({ tokens: [arg, args[++index]!] });
    else if (arg.startsWith("-")) parts.push({ tokens: [arg] });
    else parts.push({ tokens: [arg], operand: arg });
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
    if (arg) normalized.push(arg);
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
