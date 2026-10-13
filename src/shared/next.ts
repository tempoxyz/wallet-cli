/**
 * Builds the `instruction` and `_next` continuation fields for a multi-step command result.
 * `argv` follows "tempo" (e.g. `["wallet", "swap", ...]`) and carries the selected network, so
 * the next command targets the same chain. `_next.argv` is authoritative; `_next.command` is the
 * same argv quoted for a POSIX shell.
 */
export function nextStep(
  instruction: string,
  argv: readonly string[],
  options: {
    network?: string | undefined;
    pollIntervalSeconds?: number | undefined;
    until?: string | undefined;
  } = {},
) {
  const network = options.network ?? process.env.TEMPO_WALLET_NETWORK;
  const fullArgv = ["tempo", ...argv, ...(network ? ["--network", network] : [])];
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

/** Quotes a word for a POSIX shell, leaving it bare when it has no special characters. */
export function shellQuote(value: string) {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
