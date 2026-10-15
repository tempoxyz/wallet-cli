---
tempo-wallet: minor
---

`tempo wallet --mcp` now declares MCP tool annotations on every tool, so a client can tell reads from spends. `whoami`, `keys_list`, `services`, `doctor`, `debug`, and `completions` set `readOnlyHint`. `transfer`, `swap`, `sessions_close`, `sessions_sync`, `keys_update`, `revoke`, `logout`, `login`, `login_status`, and `refresh` set `destructiveHint`. `fund` and `sessions_list` change state without either. `idempotentHint` marks the tools that are safe to repeat, and `openWorldHint` every tool except `completions` and `logout`, which make no network requests.
