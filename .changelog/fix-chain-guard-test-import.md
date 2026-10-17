---
wallet-cli: none
---

Import `revokeHandler` from `src/commands/keys.ts` in the RPC chain guard test, so test types pass after `revoke` became an alias of `keys revoke`. No user-facing change.
