---
wallet-cli: patch
---

`tempo wallet transfer` token transfers on a network other than the one the wallet is logged in on now send nothing and exit 2 with `E_USAGE` and a `cta` naming `tempo wallet login --network <network>`, with or without an access key there, before any lookup or prompt, as `swap` does. The wallet app, which approves a transfer whenever no access key can sign it, approves only on the logged-in chain. An agent run without a key on that network gets this login `cta` rather than a refresh one. A transfer also checks the logged-in chain again when it sends, and sends nothing, exiting 2 with `E_USAGE`, if another login switched it meanwhile, for example while the confirmation prompt was open. `--dry-run` still reviews the transfer, and `transfer --mach` and `transfer --credits` are unchanged.
