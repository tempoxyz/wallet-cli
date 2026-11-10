---
tempo-request: patch
---

`tempo request --mach` (and `--payment-token MACH`) now tries the service's next machine-enabled charge offer when the MACH swap route for the first one cannot be simulated, such as when the DEX book for that offer's settlement currency is empty. It skips offers in a currency whose route already failed, signs and sends nothing for a failed route, and reports the first offer's "swap route could not be simulated" error only when no offer's route simulates. Before, it gave up after the first offer, so a service listing OUSD before USDC.e could not be paid with MACH while the USDC.e/OUSD book was empty. Balance, spending-limit and call-scope failures still stop at the first offer.
