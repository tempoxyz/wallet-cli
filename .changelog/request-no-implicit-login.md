---
tempo-request: minor
---

`tempo request` no longer starts a browser login when a 402 needs payment and no wallet is logged in. Without a logged-in wallet, or a `--private-key`/`TEMPO_PRIVATE_KEY` signer, it exits 4 with `E_NOT_AUTHENTICATED` and a `cta` naming `tempo wallet login --network <network>`. An expired access key now returns `E_KEY_EXPIRED` instead of `E_AUTH_REFRESH_REQUIRED`, and a missing or unusable one `E_AUTH_REFRESH_REQUIRED` (including a stored key the signer rejects, which previously failed with `E_PAYMENT`), each with a `cta` naming `tempo wallet refresh --network <network>`; previously these errors carried no `cta`. A `--dry-run` quote for a wallet that cannot pay keeps reporting the challenge and adds `instruction` and `_next` with the same command. Responses other than 402 still need no login.
