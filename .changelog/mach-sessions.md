---
wallet-cli: patch
---

Support direct-to-merchant MACH v2 sessions in `tempo request`, prefer funded MACH sessions automatically, and use a separate gas token for session top-ups and closure. Explicit `--mach` stays MACH-only; `--payment-intent charge` retains swapper-backed charges.
