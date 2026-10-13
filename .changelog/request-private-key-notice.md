---
tempo-request: patch
---

Validate `--private-key` and `TEMPO_PRIVATE_KEY` without echoing the key, report which key pays instead of the logged-in wallet on stderr, in `--dry-run` output, and in `--write-meta` metadata, and warn that `--private-key` can leak through shell history.
