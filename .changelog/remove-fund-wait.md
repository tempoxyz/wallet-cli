---
wallet-cli: minor
---

**Breaking:** Make `tempo wallet fund` a browser handoff only. Remove `fund --wait`, `--timeout`, `fund status`, the `fund_status` MCP tool, and `_next` funding continuations. Balance polling, thresholds, pending funding storage, and the funding polling environment settings are removed. This supersedes the earlier funding-status entry. `--amount` remains an editable checkout prefill.

**Migration:** Use `fund` to open the wallet, or `fund --no-browser` to return its URL, then confirm the destination wallet's intended token balance before spending. Do not replace `fund --wait && <paid command>` with `fund && <paid command>`: exit code zero and `status: "pending"` confirm only the handoff, not a deposit. Removed CLI polling commands fail with `E_USAGE` (exit 2); `--no-wait` and `--wait=false` remain harmless compatibility options. MCP clients should refresh their tool list and stop calling `fund_status` or following a funding `_next`; calls to the removed tool fail, and `fund` rejects `wait: true` or any `timeout` argument.
