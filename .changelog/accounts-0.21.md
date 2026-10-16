---
wallet-cli: patch
---

Update `accounts` to 0.21.0. `tempo wallet revoke` and `tempo wallet logout --revoke` now name the key's network in the revocation they send to the wallet app, which revokes it there even if another login switched the wallet's network in the meantime.
