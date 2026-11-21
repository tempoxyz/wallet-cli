---
tempo-request: minor
---

`tempo request` now pays one-time charges through [machine-fetch](https://github.com/tempoxyz/machine-fetch), which checks the spending cap (`--max-spend`, `TEMPO_MAX_SPEND`, the saved `max-spend`, or the default 10) against the exact offer mppx is about to sign, immediately before signing. Previously that last check ran in an mppx event listener, whose errors mppx ignores, so it could not stop a payment. An offer mppx selects that differs from the one the CLI validated, in amount, token, or chain, is now refused with `E_LIMIT_EXCEEDED` before anything is signed.

When the wallet lacks the stablecoin a charge asks for, the charge now swaps from OUSD on the Tempo Stablecoin DEX in the same transaction, spending at most the missing amount plus 1% slippage. Only OUSD is swapped from; an explicit MACH payment (`--mach` or `--payment-token MACH`) and charges in tokens the CLI does not list never swap. Sessions and subscriptions are unchanged.

Funding refusals map to the existing error codes: a balance no route can fund is `E_INSUFFICIENT_FUNDS`, a refused funding limit `E_LIMIT_EXCEEDED`, a funding failure `E_PAYMENT`, and funding that may have moved funds `E_PAYMENT_OUTCOME_UNKNOWN`. A `--dry-run` charge quote reports `within_budget` from the same policy. mppx is updated to 0.15.0.
