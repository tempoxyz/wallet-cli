import type { Network } from "./network.js";

/**
 * Builds the `instruction` and `_next` continuation fields for a multi-step command result.
 * `argv` follows "tempo" (e.g. `["wallet", "swap", ...]`) and always ends with the network the
 * command resolved, so the next command targets the same chain wherever it runs.
 * `_next.argv` is authoritative; `_next.command` is the same argv quoted for a POSIX shell.
 */
export function nextStep(
  instruction: string,
  argv: readonly string[],
  options: {
    network: Network;
    pollIntervalSeconds?: number | undefined;
    until?: string | undefined;
  },
) {
  const fullArgv = continuationArgv(argv, options.network);
  return {
    instruction,
    _next: {
      argv: fullArgv,
      command: fullArgv.map(shellQuote).join(" "),
      ...(options.until !== undefined ? { until: options.until } : {}),
      ...(options.pollIntervalSeconds !== undefined
        ? { poll_interval_seconds: options.pollIntervalSeconds }
        : {}),
    },
  };
}

/** A follow-up command as a quoted POSIX shell string, for instructions that name several. */
export function continuationCommand(argv: readonly string[], network: Network) {
  return continuationArgv(argv, network).map(shellQuote).join(" ");
}

function continuationArgv(argv: readonly string[], network: Network) {
  return ["tempo", ...argv, "--network", network.name];
}

/** Quotes a word for a POSIX shell, leaving it bare when it has no special characters. */
export function shellQuote(value: string) {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
