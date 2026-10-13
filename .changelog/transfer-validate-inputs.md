---
wallet-cli: patch
---

Validate `tempo wallet transfer` arguments before loading the wallet: missing arguments, malformed token or recipient addresses, the zero-address recipient, and non-positive or over-precise amounts now fail with `E_USAGE`, including under `--dry-run`.
