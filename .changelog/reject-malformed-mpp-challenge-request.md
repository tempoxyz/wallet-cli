---
wallet-cli: patch
---

Report a malformed `request` parameter in `tempo wallet transfer --credits --mpp-challenge` as a usage error instead of an uncaught JSON parse failure.
