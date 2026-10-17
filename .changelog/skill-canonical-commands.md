---
tempo-request: patch
---

`SKILL.md` names the canonical commands and MCP tools: `tempo wallet send` and `send` for token transfers, keeping `transfer` for `--mach` and `--credits` payments; `tempo wallet keys revoke` and `keys_revoke` instead of the deprecated `revoke`; and `services search <query>`, `services show <id>`, and `services list` instead of `services --search` and `services <id>`. It adds `tempo wallet balance` and `tempo wallet address`, a Settings section on `tempo wallet config` (each key's precedence, the confirmation `config set` and `config unset` need, and the `rpc-url` chain check), and the saved `network` and `max-spend` in the network and spending-cap rules. Its list of MCP tools that refuse to act without `yes: true` now matches the CLI: `send` (and a token `transfer`), `swap`, `keys_revoke`, `sessions_close`, `config_set`, `config_unset`, and `logout` when it needs confirmation.
