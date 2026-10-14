---
wallet-cli: patch
---

Wallet commands wait for the wallet store to load before using the wallet provider. On a slow machine, `transfer`, `swap`, `sessions close`, `keys update`, `revoke`, and paid requests could fail with "No accounts connected." or `Account "0x…" not found.`, `tempo request` could start a new login for a logged-in wallet, and `tempo wallet login` could drop the access keys already stored.
