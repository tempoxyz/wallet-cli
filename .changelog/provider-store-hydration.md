---
wallet-cli: patch
---

Wallet commands wait for the wallet store to load before using the wallet provider. On a slow machine, `transfer`, `swap`, `sessions close`, `keys update`, `revoke`, and paid requests could fail with "No accounts connected." or `Account "0x…" not found.`, `tempo request` could start a new login for a logged-in wallet, and `tempo wallet login` could drop the access keys already stored.

A wallet store that cannot be read, or has not loaded within 10 seconds, fails the command with `E_RUNTIME` instead of running it on an empty store. `transfer`, `swap`, and `sessions close` now send from the wallet they checked, and refuse with `E_NOT_AUTHENTICATED` when another login has replaced that wallet in the meantime, instead of sending from the other wallet.
