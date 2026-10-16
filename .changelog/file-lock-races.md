---
wallet-cli: patch
---

Session payments in `tempo request`, and `--idempotency-key` sends in `tempo wallet transfer` and `tempo wallet swap`, no longer let two waiting processes into their lock at once after its holder was killed. The lock is now an OS file lock held by a `sqlite3` child, which needs `sqlite3` on `PATH` as the session store does, and the system releases it when its holder exits, so no stale lock is ever taken over. An `EEXIST` error inside a locked step no longer runs the step again. Session locks hash origins into at most 256 files under `~/.tempo/wallet/session-locks/`, kept between uses instead of deleted.
