---
wallet-cli: patch
---

`tempo wallet swap` is now sent only on the chain the wallet is logged in on, with that chain set explicitly on the transaction. Previously a swap quoted and reviewed with `--network` on another network was submitted on the logged-in chain. Such a swap is now refused before quoting, with or without an access key for that network, since the wallet app that approves a swap no key can sign works on the logged-in chain: it sends nothing and exits 2 with `E_USAGE` and a `cta` naming `tempo wallet login` with that `--network`. Its dry run still quotes.
