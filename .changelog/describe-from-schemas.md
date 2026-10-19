---
tempo-wallet: patch
---

`tempo wallet --describe` is generated from the commands and their option schemas, so it lists what the parser accepts, with the help `--help` shows. It now lists the options of bare `sessions` (`--orphaned`, `--all`) and bare `services` (`--refresh`), and describes `--verbose` as the boolean flag it is rather than an option taking a value. The help of `--network`, `login --wait`, `login status`, `fund`, `fund status`, `keys update`, `swap`, and `transfer` arguments and options is now their `--help` or MCP text. `--help` for `whoami` and `keys list` notes that `spending_limit` is deprecated, and `send` and `transfer` describe the default `--fee-token`.
