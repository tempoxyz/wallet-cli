---
tempo-request: patch
---

`SKILL.md` now has agents quote a request with `tempo request -t --dry-run`, present the price, and wait for explicit approval before running the paid request bound to that quote with `--max-spend`, `--payment-intent`, and `--payment-token`, unless the user already gave a budget that covers it. A subscription quote (`recurring: true`) is reported instead of run, since the quote does not show its renewal terms, and a dry run of an endpoint that needs no payment has already sent the request. The skill also covers Tempo Mainnet, Moderato testnet, and how commands select the network, and declares its `MIT OR Apache-2.0` license.
