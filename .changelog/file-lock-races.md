---
wallet-cli: patch
---

Session payments in `tempo request`, and `--idempotency-key` sends in `tempo wallet transfer` and `tempo wallet swap`, no longer let two waiting processes into their lock at once after its holder was killed. The lock is now an OS file lock held by a `sqlite3` child, which the system releases when its holder exits, so no stale lock is ever taken over. An `EEXIST` error inside a locked step no longer runs the step again. Without `sqlite3` on `PATH`, a session payment fails with `E_USAGE` (formerly `E_PAYMENT`) saying to install it, with `tempo wallet doctor` as its `cta`, and an `--idempotency-key` send falls back to a pid-file lock that is never taken over: one left by a process that has exited fails with retryable `E_RUNTIME` naming the file and that process, and saying to remove the file once no `tempo` process is running. Session locks are kept as one empty file per origin in `~/.tempo/wallet/session-locks/`.
