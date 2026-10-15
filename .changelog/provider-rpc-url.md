---
wallet-cli: patch
---

Transactions the wallet provider fills, signs, and sends with the local access key (`tempo wallet transfer`, `swap`, and `sessions close`) now use `TEMPO_RPC_URL`, or the CLI's default RPC for the network, like every other RPC call the CLI makes. They previously went to viem's built-in chain RPC and ignored `TEMPO_RPC_URL`.
