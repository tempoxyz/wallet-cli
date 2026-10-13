---
tempo-request: patch
---

Validate `--private-key` and `TEMPO_PRIVATE_KEY` without echoing the key, report which key pays instead of the logged-in wallet on stderr and in `--dry-run` output, and warn that `--private-key` can leak through shell history.
