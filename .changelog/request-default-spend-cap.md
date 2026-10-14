---
tempo-request: minor
---

Cap `tempo request` spending at 10 payment token units (about $10 in stablecoins) when neither `--max-spend` nor `TEMPO_MAX_SPEND` is set. The cap bounds each charge, each session deposit, a reused session's cumulative vouchers, and session top-ups. A session deposit suggested above the cap is lowered to the cap, since opening needs only a deposit that covers the per-call amount. A payment over the cap, under the default or an explicit cap, is now refused with `E_LIMIT_EXCEEDED` (exit 4) before it is signed, instead of `E_PAYMENT`, and its `cta` reruns the same command with the needed `--max-spend` and the resolved `--network`. A top-up over the cap is refused the same way instead of surfacing the server's 402. Recurring subscriptions are not subject to the default cap. `--dry-run` previews, including `tempo wallet transfer --mach --dry-run`, check offers against the same default.
