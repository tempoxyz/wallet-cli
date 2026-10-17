---
wallet-cli: patch
---

Update `accounts` to 0.21.0. Revocations now name the key's network, so `tempo wallet logout --revoke` revokes keys on every network it logs out of, including networks the wallet is not logged in on, instead of failing with `E_USAGE` and asking for a logout per network.

`tempo wallet revoke` no longer undoes a login another process makes while it waits for confirmation or the wallet app. `tempo wallet logout` stops with a retryable `E_USAGE`, writing nothing, when such a login or refresh changes the wallets, network, or keys it logs out of.
