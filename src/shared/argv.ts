import type { z } from "incur";

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
