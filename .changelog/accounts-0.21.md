---
wallet-cli: patch
---

Update `accounts` to 0.21.0. Revocations now name the key's network, so `tempo wallet logout --revoke` revokes keys on every network it logs out of, including networks the wallet is not logged in on, instead of failing with `E_USAGE` and asking for a logout per network.
