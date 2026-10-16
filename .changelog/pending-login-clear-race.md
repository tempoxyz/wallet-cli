---
wallet-cli: patch
---

A `tempo wallet login` that ends while another login starts no longer deletes the newer login's pending code, which left `tempo wallet login status` reporting the newer login cancelled.
