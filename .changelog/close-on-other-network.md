---
wallet-cli: patch
---

`tempo wallet sessions close` (the on-chain `requestClose` and `withdraw` path) now works for a session on a network other than the last one you logged in on, as long as the wallet holds an access key on the session's network. The transaction names the session's chain, and the provider signs it with that chain's key. Before, it refused with "wallet is logged in on tempo, not tempo-moderato" even with a key for the session's network, so you had to log in again just to close. Without a key on that network, it now says "wallet has no access key on <network>" and names the login to run.
