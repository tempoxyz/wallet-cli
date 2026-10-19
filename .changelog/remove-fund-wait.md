---
wallet-cli: minor
---

Remove `tempo wallet fund --wait` and `--timeout`: `fund` always returns the browser handoff without polling for deposits. Both flags fail with `E_USAGE` before starting a flow, including through MCP, so scripts cannot mistake a handoff for completed funding. Use `fund status` to wait for an existing handoff; `--no-wait` and `--wait=false` remain harmless compatibility options. Remove the unused `TEMPO_WALLET_FUND_TIMEOUT_MS` setting.
