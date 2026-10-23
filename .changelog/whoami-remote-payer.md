---
tempo-wallet: minor
---

`tempo wallet whoami` reports `remote_payer`, the wallet's key for paying on other chains, once a payment has created it: its lowercase `address` and `balances`, its USDC on each chain as `{ chain_id, network, token, symbol, balance }`, with `balance` `null` when the read failed.
