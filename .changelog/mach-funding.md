---
wallet-cli: minor
---

Replace legacy MPP Credits entry points with onchain MACH funding, balance queries, and capped MPP payments. Add remote checkout handoffs, bounded funding waits, explicit MACH selection with no stablecoin fallback, and recovery for uncertain payment outcomes. Deprecated `--credits` aliases now select MACH with a warning; existing offchain credits are not converted or redeemed.
