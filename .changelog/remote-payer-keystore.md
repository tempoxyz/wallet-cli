---
tempo-request: patch
tempo-wallet: minor
---

The remote payer (the key that pays on Base and other EVM chains) is now created by the wallet's
secp256k1 keystore and kept in the wallet store with the access keys, as the
`tempo-cli.remotePayers` item. Saving wallet state now keeps every other item in the store, so no
rewrite drops it, and logout keeps it. `remote-payers.json` remains as a write-once backup that
restores any payer the store loses; an existing file is migrated into the store on first use.
`tempo wallet keys list` shows the active wallet's remote payer.
