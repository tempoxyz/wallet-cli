---
wallet-cli: patch
---

A login saving its pending login no longer fails with `ENOENT` when another login clears it at the same moment.
