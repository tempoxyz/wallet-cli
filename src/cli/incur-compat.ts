/**
 * Workarounds for incur bugs. `patches/incur@0.7.1.patch` is another: it keeps a cta naming the
 * program of a multi-word CLI (`tempo wallet ...` from `tempo request`) unprefixed. Upstream:
 * https://github.com/wevm/incur/pull/252, merged but unreleased. Remove the patch and its
 * `pnpm-workspace.yaml` entry once incur > 0.7.1 includes wevm/incur#252.
 */
import { Errors, type z } from "incur";

import { cliGlobalAlias, cliGlobals } from "../schemas/shared.js";
import type { CommandErrorPayload } from "../shared/errors.js";
import { commandTokens } from "./argv.js";
import { isCommandGroup, isRunnableCommand, type RunnableCommand } from "./command.js";

/** An option schema and its short aliases, as passed to incur. */
export type OptionSpec = {
  options?: z.ZodObject | undefined;
  alias?: Record<string, string | undefined> | undefined;
};

/**
 * Binds each value-taking option to its value (`-d X` and `--data X` become `--data=X`) and
 * splits stacked short flags (`-sn testnet` becomes `-s --network=testnet`). incur extracts CLI
 * globals from the whole argv before parsing command options, so an unbound value such as `-n`
 * or `--network=testnet` would otherwise be taken as the global `--network`. Stops at `--`.
 *
 * Upstream: https://github.com/wevm/incur/pull/258 parses globals with the command's option
 * arity; built-in flags such as `--json` and `--help` are still open upstream. Remove once
 * incur > 0.7.1 includes wevm/incur#258 and parses built-in flags the same way, keeping curl's
 * `--json <body>` in `normalizeIncurArgv`.
 */
export function bindOptionValues(argv: readonly string[], specs: readonly OptionSpec[]) {
  const long = new Map<string, boolean>();
  const short = new Map<string, { name: string; value: boolean }>();
  for (const { options, alias } of specs) {
    for (const [name, field] of Object.entries(options?.shape ?? {})) {
      const value = takesValue(field as z.ZodType);
      long.set(name, value);
      long.set(
        name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`),
        value,
      );
    }
    for (const [name, char] of Object.entries(alias ?? {}))
      if (char) short.set(char, { name, value: long.get(name) ?? false });
  }

  const out: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const next = argv[index + 1];
    if (arg === "--") {
      out.push(...argv.slice(index));
      break;
    }
    if (arg.startsWith("--")) {
      if (long.get(arg.slice(2)) && next !== undefined) {
        out.push(`${arg}=${next}`);
        index++;
      } else out.push(arg);
      continue;
    }
    const flags = /^-[^-]/.test(arg) ? Array.from(arg.slice(1), (char) => short.get(char)) : [];
    // Leave unknown flags, and stacks where a value-taking flag is not last, for incur to report.
    if (
      flags.length === 0 ||
      flags.some((flag, i) => !flag || (flag.value && i < flags.length - 1))
    ) {
      out.push(arg);
      continue;
    }
    for (const [i, flag] of flags.entries()) {
      if (flag!.value && next !== undefined) {
        out.push(`--${flag!.name}=${next}`);
        index++;
      } else out.push(`-${arg[i + 1]}`);
    }
  }
  return out;
}

function takesValue(field: z.ZodType) {
  let def = field.def as { innerType?: z.ZodType; type: string };
  while (def.innerType) def = def.innerType.def as typeof def;
  return def.type !== "boolean";
}

/**
 * Binds the target command's option values before incur extracts globals; see bindOptionValues.
 *
 * Upstream: https://github.com/wevm/incur/pull/258. Remove with `bindOptionValues`.
 */
export function bindCommandOptions(args: readonly string[], commands: Map<string, unknown>) {
  const [name, subcommand] = commandTokens(args);
  const entry = name === undefined ? undefined : commands.get(name);
  // A group without a known subcommand runs its root command (bare `sessions`).
  const command = isCommandGroup(entry)
    ? ((subcommand === undefined ? undefined : entry.commands.get(subcommand)) ?? entry.root)
    : entry;
  return bindOptionValues(args, [
    ...(isRunnableCommand(command) ? [command] : []),
    { options: cliGlobals, alias: cliGlobalAlias },
  ]);
}

/**
 * MCP tool calls carry no CLI globals, so accept `network` as a tool option and pass it on.
 *
 * Upstream: https://github.com/wevm/incur/pull/260. Remove once incur > 0.7.1 includes
 * wevm/incur#260, passing `cliGlobals` to `Mcp.serve` as `globals` instead.
 */
export function withMcpGlobal<command extends RunnableCommand>(entry: command) {
  return {
    ...entry,
    options: entry.options ? entry.options.extend(cliGlobals.shape) : cliGlobals,
    run(context: { options: Record<string, unknown> }) {
      const { network, ...options } = context.options;
      return entry.run({ ...context, globals: { network }, options });
    },
  };
}

/**
 * A `commandError` thrown below a command's `run`, where returning `c.error` is not possible.
 * incur drops the `cta` of thrown errors, so each CLI registers `ctaErrors`, which returns it
 * through `c.error` instead.
 *
 * Upstream: https://github.com/wevm/incur/pull/259 keeps the `cta` of thrown errors. Remove this
 * and `ctaErrors` once incur > 0.7.1 includes wevm/incur#259, throwing `Errors.IncurError` with
 * its `cta` instead.
 */
export class CtaError extends Errors.IncurError {
  /** The `c.error` payload, `cta` included. */
  readonly payload: CommandErrorPayload;

  constructor(payload: CommandErrorPayload) {
    super(payload);
    this.payload = payload;
  }
}

/**
 * incur middleware that returns a thrown `CtaError` through `c.error`, keeping its `cta`.
 *
 * Upstream: https://github.com/wevm/incur/pull/259. Remove with `CtaError`.
 */
export async function ctaErrors(
  context: { error: (payload: CommandErrorPayload) => never },
  next: () => Promise<void>,
) {
  try {
    await next();
  } catch (error) {
    if (!(error instanceof CtaError)) throw error;
    context.error(error.payload);
  }
}
