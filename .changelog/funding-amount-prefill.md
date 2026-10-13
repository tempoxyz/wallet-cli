---
wallet-cli: patch
---

Return the funding handoff immediately by default. Use `--wait` to watch for a positive balance increase; `--amount` supplies the checkout amount without requiring an equivalent deposit. Scripts that depended on the old blocking behavior must add `--wait`.
