---
wallet-cli: minor
---

`tempo wallet revoke` now sends the revocation through the wallet app, so it works after a device-code login, where the CLI holds no signer for the wallet itself. It revokes a key stored for the logged-in wallet on the selected network, or one created elsewhere that the chain shows authorized for that wallet, and fails with `E_USAGE` listing the wallet's stored keys otherwise. A stored key not yet published on-chain is authorized and revoked in one transaction, and the command reports success only once the chain shows the key revoked; otherwise it keeps the local key and returns `E_NETWORK`. Because revocation cannot be undone, an interactive run asks to confirm and an agent run needs `--yes`; without it, it returns `E_USAGE` with a `cta` that adds `--yes`. `--dry-run` shows the key, wallet, network, limits, and expiry, and its `_next` adds `--yes`.

`tempo wallet refresh` and `revoke` accept `--no-browser`, like `login` and `keys update`, to print the wallet-app URL and confirmation code instead of opening a browser.

A wallet-app request that fails or whose device code expires is no longer resent up to three more times, so each approval shows one confirmation code. This covers `revoke` and wallet-app approvals for transfers, swaps, session closes, and payments.
