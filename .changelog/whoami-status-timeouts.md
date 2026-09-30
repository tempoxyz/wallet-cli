---
tempo-wallet: patch
---

Query `whoami` balances, asset discovery, and session reserves concurrently, and bound status RPC and asset lookups to three seconds so a stalled upstream no longer blocks for ~40 seconds.
