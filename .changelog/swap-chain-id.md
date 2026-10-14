---
wallet-cli: patch
---

`tempo wallet swap` now sends on the resolved network instead of the chain the wallet was last logged in on, so a swap quoted and reviewed with `--network` is submitted on that network. An interactive swap without an access key for the resolved network, which the wallet app would approve on the logged-in chain, is refused before quoting when the wallet is logged in on another network: it sends nothing and exits 2 with `E_USAGE` and a `cta` naming `tempo wallet login` with that `--network`. Its dry run still quotes.
