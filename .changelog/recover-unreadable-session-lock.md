---
wallet-cli: patch
---

Release session locks left without a usable pid by a holder that died before recording it, instead of timing out every later request to that origin.
