---
wallet-cli: minor
---

`tempo wallet revoke` now sends the revocation through the wallet app, so it works after a device-code login, where the CLI holds no signer for the wallet itself. It only revokes a key stored for the logged-in wallet on the selected network, and fails with `E_USAGE` listing that wallet's keys otherwise. Because revocation cannot be undone, an interactive run asks to confirm and an agent run needs `--yes`; without it, it returns `E_USAGE` with a `cta` that adds `--yes`. `--dry-run` shows the key, wallet, network, limits, and expiry, and its `_next` adds `--yes`.

`tempo wallet refresh` and `revoke` accept `--no-browser`, like `login` and `keys update`, to print the wallet-app URL and confirmation code instead of opening a browser.
