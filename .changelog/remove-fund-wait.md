---
wallet-cli: minor
---

Make `tempo wallet fund` a browser handoff only. Remove `fund status`, its MCP tool, `--wait`, `--timeout`, balance reads and thresholds, pending funding storage, and funding polling environment settings. `--amount` is only an editable checkout prefill. Old CLI polling commands fail with `E_USAGE` instead of silently starting another handoff; `--no-wait` and `--wait=false` remain harmless compatibility options. A successful exit with `status: "pending"` confirms the handoff, not a deposit; check the intended token's balance after funding before spending.
