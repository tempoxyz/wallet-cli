---
wallet-cli: patch
---

`tempo wallet transfer` token transfers on a network other than the one the wallet is logged in on now send nothing and exit 2 with `E_USAGE` and a `cta` naming `tempo wallet login --network <network>`, with or without an access key there, before any lookup or prompt, as `swap` does. The wallet app, which approves a transfer whenever no access key can sign it, approves only on the logged-in chain. `--dry-run` still reviews the transfer, and `transfer --mach` and `transfer --credits` are unchanged.
