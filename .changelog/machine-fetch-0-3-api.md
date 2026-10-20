---
tempo-request: patch
---

Vendored machine-fetch is now its latest `main` (`cec3535`), which reorganizes its public API into
namespaced modules on flat subpaths, gives every failure its own error class, and renames attempt
IDs to operation IDs. The CLI is migrated with no change to what it pays or how it funds, except
that a payment the CLI's own Tempo DEX funder does not swap for now tells Mppx explicitly not to
auto-swap, so a method-level auto-swap can never apply either.
