---
wallet-cli: patch
---

`tempo wallet fund` toon output no longer shows `symbol: null` for flows other than `--mach`. The field is now omitted, as JSON output already omitted it, so both formats report the same keys.
