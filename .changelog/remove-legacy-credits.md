---
wallet-cli: minor
---

Remove legacy off-chain credit balances and payments. `tempo wallet transfer` now always pays MPP challenges with MACH, without a mode flag. Use `tempo wallet send` for token transfers. Removed flags and unknown MCP arguments are rejected instead of selecting another payment flow.
