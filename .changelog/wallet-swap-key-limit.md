---
tempo-wallet: patch
---

`tempo wallet swap` checks what the access key has left of its limit on chain, not the limit it was granted. It also requires twice the swap's maximum input, because the approve and the DEX's pull both count against the limit. A key that falls short is refused before submitting, with `E_LIMIT_EXCEEDED` and a `tempo wallet keys update` naming the limit needed. Previously such a swap passed the check and then fell back to approval in the wallet app.
