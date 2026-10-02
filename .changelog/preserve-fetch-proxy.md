---
wallet-cli: patch
---

Preserve the runtime's existing fetch dispatcher when loading the request transport, so Node 22 RPC and provider calls continue to honor environment proxies.
