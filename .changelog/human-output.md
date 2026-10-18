---
wallet-cli: minor
---

`tempo wallet` prints a human-readable view when stdout is a terminal and no output format is asked for. Objects print as aligned `Label  value` blocks and lists as tables (or blocks when a table would not fit the terminal width), with labels taken from the output keys, amounts shown with their token symbol, token addresses shortened to `0x20c0…8b50`, raw base-unit amounts left out when a formatted amount shows them, and `_next` and `cta` commands as `Next:` lines. Errors print on stderr as `Error: <message>` with any `Next:` fix, keeping their exit codes. Labels are dimmed, successes green, and failures red, only on a terminal and as `NO_COLOR` and `FORCE_COLOR` say. Piped output, `--format`, `--json`, `-j`, `-t`, `--json-output`, `--toon-output` (unless `=false`), `--full-output`, `--filter-output`, `--schema`, `--llms`, and MCP output are unchanged.
