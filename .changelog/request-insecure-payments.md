---
tempo-request: minor
---

Refuse to pay a 402 challenge when `--insecure`/`-k` disables TLS certificate verification, unless `--allow-insecure-payment` is passed. `--dry-run` quotes remain allowed. Describe `--insecure` accurately in help and `--describe` output.
