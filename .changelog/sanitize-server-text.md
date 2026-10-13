---
wallet-cli: patch
---

Strip terminal escape sequences and invisible Unicode from server-supplied text in service listings, payment errors, and cooperative session close errors, and show server-supplied identifiers such as challenge IDs with visible escapes. Service directory entries whose id is not a plain slug are skipped, and duplicate ids are reported instead of resolved to the first match.
