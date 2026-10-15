---
tempo-wallet: minor
---

`tempo wallet --mcp` now declares MCP tool annotations on every tool, so a client can tell reads from spends. `whoami`, `keys_list`, `sessions_list`, `services`, `doctor`, `debug`, and `completions` set `readOnlyHint`. `transfer`, `swap`, `sessions_close`, `keys_update`, `revoke`, and `logout` set `destructiveHint`. `login`, `login_status`, `refresh`, `fund`, and `sessions_sync` change state without either. `idempotentHint` marks the tools that are safe to repeat, and `openWorldHint` every tool except `completions` and `logout`, which make no network requests.
