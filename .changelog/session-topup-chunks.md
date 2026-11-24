---
wallet-cli: patch
---

`tempo request` session top-ups now add the largest of the shortfall, the server's `suggestedDeposit`, and a chunk of the spending cap (the whole headroom under an explicit `--max-spend`, else the current deposit, so the deposit doubles), bounded by the cap and by what the wallet can spend: a top-up whose fee the wallet pays in the session token leaves that fee in the balance, and one whose key limit cannot be read adds only the shortfall. A reused session's `--dry-run` `deposit` quotes the same lowered top-up. Before, each top-up added only the shortfall, so a session whose deposit was used up sent one top-up transaction per call. Before opening a session, topping one up, or signing a charge, `tempo request` now reads the access key's remaining on-chain spending limit and the wallet's balance and refuses with `E_LIMIT_EXCEEDED` (or an insufficient-balance error) instead of sending a transaction the chain would reject.
