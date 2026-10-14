---
wallet-cli: patch
---

`tempo wallet keys update` on an access key not yet published on chain, such as one from a recent login, now keeps the replacement key authorization the wallet app returns. It previously overwrote the wallet store with the copy it loaded before the update, so the key's first payment could publish the old limit while `keys list` showed the new one.
