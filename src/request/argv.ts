import { bindOptionValues, type OptionSpec } from "../shared/argv.js";

export function normalizeIncurArgv(argv: readonly string[], optionSpecs: readonly OptionSpec[]) {
  // Binding also turns `--json <body>` into `--json=<body>`: incur reserves exact `--json` as an
  // output-format flag, and `tempo request` keeps curl's `--json <body>`.
  const bound = bindOptionValues(argv, optionSpecs);
  const out: string[] = [];
  for (const arg of bound) {
    if (arg === "--no-proxy") {
      // Incur treats --no-foo as boolean negation of --foo. `tempo request`
      // intentionally supports curl's separate --proxy <url> and --no-proxy
      // flags, so route the spelling around Incur's negation parser.
      out.push("--noProxy");
      continue;
    }
    if (arg === "-j" || arg === "--json-output") {
      out.push("--format", "json");
      continue;
    }
    out.push(arg);
  }
  return out;
}

export const redacted = "<redacted>";
const credentialOptions = new Set(["private-key", "bearer", "user"]);
const credentialHeader = /auth|cookie|key|secret|token|pass|session/i;

/**
 * The invocation's arguments for a rerun that sets the `replaced` options itself. Values are
 * bound to their options as incur parses them, so `-n` in a stack such as `-sn testnet` is
 * dropped while a value that looks like an option (`-d -n`) is kept. Credentials are replaced by
 * `<redacted>` so the suggestion never echoes them.
 */
export function rerunArgs(
  argv: readonly string[],
  optionSpecs: readonly OptionSpec[],
  replaced: readonly string[],
) {
  return bindOptionValues(argv, optionSpecs)
    .filter((arg) => !replaced.some((name) => arg === `--${name}` || arg.startsWith(`--${name}=`)))
    .map(redactCredential);
}

/** Redacts `--private-key`, `--bearer`, `--user`, proxy credentials and credential-like headers. */
function redactCredential(arg: string) {
  const [, name, value = ""] = /^--([^=]+)=(.*)$/s.exec(arg) ?? [];
  if (!name) return arg;
  if (credentialOptions.has(name) || (name === "proxy" && value.includes("@")))
    return `--${name}=${redacted}`;
  const header = name === "header" ? /^([^:]+):/.exec(value)?.[1] : undefined;
  if (header && credentialHeader.test(header)) return `--header=${header}: ${redacted}`;
  return arg;
}
