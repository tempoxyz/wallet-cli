---
tempo-wallet: minor
---

`tempo wallet login --id` signs in with Tempo ID instead of a passkey, on mainnet or testnet. It adds `tempo_id=true` to the approval link the CLI prints and opens, so the wallet app's approval page offers Tempo ID's sign-in; `--no-wait` returns the same link as `verification_url`, and when a `--id` login is denied or expires, `login status` suggests retrying with `--id`. It needs a wallet app that accepts Tempo ID approvals of CLI logins on that network.
