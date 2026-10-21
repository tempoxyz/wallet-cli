---
tempo-request: minor
---

With `--funding auto` (or `TEMPO_EXPERIMENTAL_CROSS_CHAIN=1`), `tempo request` funds an EVM offer the remote payer cannot fully cover. It bridges exactly the shortfall to USDC on the offer's chain, from USDC.e or OUSD on Tempo, whichever the wallet holds enough of, through the cheaper quoted route, then pays.

- **Routes:**
  - Relay, by contract deposit into Relay's pinned v2 depository: an `approve` and `depositErc20`, validated and re-encoded before signing.
  - Stargate, from USDC.e, paying LayerZero's fee in LZD within the same transaction.
- **Cap:** `--max-funding-spend` caps the source token one funding may spend, bridge fee and gas included. The default is `--max-spend` plus 5% and 0.10. A quote over the cap, or over the wallet's balance, is refused before signing, with the amount it needs. When no route can fund a payment, the error gives each route's reason, such as "Relay is unreachable".
- **Completion:** a bridge counts as completed only once its delivery is visible on the destination chain. Either the payer's balance covers the payment, read no earlier than the block that showed the delivery, or a destination transaction the provider names transferred the output to the payer.
- **Deadline:** a bridge has five minutes to deliver.
- **Recovery:** the attempt is saved before funds move. Rerunning a request that a crash or timeout interrupted reconciles its funding instead of bridging again, and a new funding first reconciles earlier ones to the same chain. A Stargate send whose hash was never recorded is found by its `OFTSent` log.
- **Unclear outcomes:** funding whose outcome is unclear fails with `E_PAYMENT_OUTCOME_UNKNOWN` and the `tempo wallet funding recover` command.
- Progress goes to stderr. `TEMPO_RELAY_URL` and `TEMPO_LAYERZERO_SCAN_URL` set the providers' APIs. Testnet has no cross-chain route.
