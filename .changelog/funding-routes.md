---
tempo-request: minor
tempo-wallet: patch
---

Cross-chain funding now works from Tempo mainnet. Relay does not offer strict deposit addresses
from Tempo, so the Relay route now makes a contract deposit into Relay's pinned v2 depository,
validating and re-encoding the approve and `depositErc20` calls before signing. A second route
bridges USDC.e through Stargate, paying LayerZero's fee in LZD within the same transaction; each
payment is funded from USDC.e or OUSD, whichever the wallet holds enough of, through the cheapest
quoted route. `--funding off` with `--payment-network <evm chain>` now pays that chain from USDC
the payer already holds instead of falling back to Tempo, a missing source balance is reported
before any quote, and a route's refusal reason is shown when no route can fund a payment.
