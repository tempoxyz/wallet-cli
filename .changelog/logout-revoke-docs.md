---
wallet-cli: none
---

Document that `tempo wallet logout --revoke` revokes keys on every network it logs out of, and that a logout interrupted by a concurrent login or refresh fails with a retryable `E_USAGE` without logging out.
