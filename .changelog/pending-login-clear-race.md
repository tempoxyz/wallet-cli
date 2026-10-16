---
wallet-cli: patch
---

A `tempo wallet login` that ends while another login starts no longer deletes the newer login's pending code, which left `tempo wallet login status` reporting the newer login cancelled. A `tempo wallet logout` that cannot cancel the pending login it logs out now fails with a retryable error naming the same command, before changing the wallet store, instead of letting that login finish after the logout.
