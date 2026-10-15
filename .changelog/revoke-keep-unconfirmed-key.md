---
wallet-cli: patch
---

`tempo wallet revoke` keeps the local access key when the wallet app returns but the chain does not show the key revoked, as its `E_NETWORK` error already said. The wallet SDK drops the key from the store as soon as the wallet app returns, so the key is now restored from the store as it was before the revocation.
