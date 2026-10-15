/** `help [command...]` is shorthand for `[command...] --help`. */
export function expandHelp(args: string[]) {
  const index = firstCommandIndex(args);
  if (index === undefined || args[index] !== "help") return args;
  return [...args.slice(0, index), ...args.slice(index + 1), "--help"];
}

/**
 * For `services`, `--json-output` (`-j`) and `--toon-output` (`-t`) become `--format json` or
 * `--format toon` after the command name, unless `--format` is already set.
 */
export function normalizeServicesOutputAliases(args: readonly string[]) {
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
