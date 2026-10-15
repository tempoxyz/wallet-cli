---
tempo-wallet: patch
---

`tempo wallet sessions list --all` and `--orphaned`, and `sessions close --all` and `--orphaned`, no longer overwrite a stored session when they find its channel on-chain. A session stored while the scan ran, or one stored for the origin `http://127.0.0.1`, which the listing skips, was replaced by an orphaned record without its origin, request URL, or signer.
