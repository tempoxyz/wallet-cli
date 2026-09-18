---
wallet-cli: patch
---

Format negative bigint token and credit balances without embedding the minus sign inside padded fractional digits. Cache `nowSeconds()` in session list remaining-seconds so a clock tick cannot produce a negative grace countdown.
