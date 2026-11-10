---
wallet-cli: minor
---

Remove legacy off-chain credit balance lookups and payments from `tempo wallet`. Its `--credits` options and equivalent Model Context Protocol (MCP) tool arguments now return `E_USAGE` before making network requests. On-chain balances, token transfers, and MACH token payments are unchanged.
