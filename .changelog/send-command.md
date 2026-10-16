---
tempo-wallet: minor
---

Add `tempo wallet send <amount> <token> <to>` and the MCP tool `send`, which send a token transfer with the arguments, options (`--fee-token`, `--dry-run`, `--yes`, `--idempotency-key`, `--address`), output, confirmation, and logged-in network check of `transfer`. Token transfer dry runs now point `_next` at `tempo wallet send`, and a missing argument names its usage.

The token form of `tempo wallet transfer` and of the MCP `transfer` tool is a deprecated alias that runs the same command; it will be removed in a future release. Run from a terminal, a token `transfer` prints a notice on stderr; agent runs, including MCP and `--format`, get no notice and the same output as `send`. `transfer --mach` and `transfer --credits` are unchanged, and `send --mach` or `send --credits` fails with `E_USAGE` and a `cta` naming the same command under `transfer`, sending nothing; an explicit false, such as `--mach=false` or `--no-credits`, selects no mode and sends tokens as usual. An `--idempotency-key` used with `transfer` replays under `send`, and the reverse.
