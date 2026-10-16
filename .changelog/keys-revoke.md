---
tempo-wallet: minor
---

Move `tempo wallet revoke` to `tempo wallet keys revoke`, next to `keys list` and `keys update`, with the same arguments, confirmation, and output. Its `_next` and `cta` commands now name `tempo wallet keys revoke`, and MCP serves it as `keys_revoke`.

`tempo wallet revoke` and the MCP `revoke` tool are deprecated aliases that run the same command; they will be removed in a future release. Run from a terminal, `revoke` prints a notice on stderr; agent runs, including MCP and `--format`, get no notice and the same output as `keys revoke`.
