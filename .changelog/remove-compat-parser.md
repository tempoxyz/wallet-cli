---
wallet-cli: minor
---

Run `tempo wallet fund`, bare `tempo wallet sessions`, `login --no-browser`, and `help` through the regular command parser. `--format` now applies to their output (TOON by default, like other commands), `fund` errors use the standard error output, `fund --llms` prints the manifest instead of starting a funding flow, and `tempo wallet help <command>` shows that command's help. `tempo wallet completions` now hooks the `tempo` launcher so bash and zsh completions work for `tempo wallet`, and the PowerShell and Elvish scripts register for `tempo` and list every command, including `swap`.
