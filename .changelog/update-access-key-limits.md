---
wallet-cli: minor
---

Added access key limit updates and moved key listing from `keys` to `keys list`.

```diff
-tempo wallet keys
+tempo wallet keys list
+tempo wallet keys update [access-key] --limit <amount>
```
