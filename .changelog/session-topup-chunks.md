---
wallet-cli: patch
---

`tempo request` session top-ups now add the largest of the shortfall, the server's `suggestedDeposit`, and a chunk of the spending cap (the whole headroom under an explicit `--max-spend`, else the current deposit, so the deposit doubles), bounded by the cap and by what the wallet can spend. Before, each top-up added only the shortfall, so a session whose deposit was used up sent one top-up transaction per call. Before opening a session, topping one up, or signing a charge, `tempo request` now reads the access key's remaining on-chain spending limit and the wallet's balance and refuses with `E_LIMIT_EXCEEDED` (or an insufficient-balance error) instead of sending a transaction the chain would reject.
