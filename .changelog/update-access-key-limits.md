---
wallet-cli: major
---

Added access key limit updates and moved key listing from `keys` to `keys list`.

```diff
-tempo wallet keys
+tempo wallet keys list

-keys
+keys_list
```
