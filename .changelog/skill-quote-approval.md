---
tempo-request: patch
---

`SKILL.md` now has agents quote a request with `tempo request -t --dry-run`, present the price, and wait for explicit approval before running the paid request, unless the user already gave a budget that covers it. It notes that a dry run of an endpoint that needs no payment has already sent the request, adds a section on Tempo Mainnet, Moderato testnet, and how commands select the network, and declares the skill's `MIT OR Apache-2.0` license.
