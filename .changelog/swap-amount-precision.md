---
wallet-cli: patch
---

Reject `tempo wallet swap` amounts with more fractional digits than the token's decimals with `E_USAGE` instead of silently rounding them, in both exact-input and `--exact-out` modes and under `--dry-run`.
