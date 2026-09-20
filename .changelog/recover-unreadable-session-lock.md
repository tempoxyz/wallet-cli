---
wallet-cli: patch
---

Fixed `withSessionLock` to release a lock file that carries no usable pid. The lock is created by `open(path, "wx")` and its pid written as a separate step, so a holder that died in between left an empty file that stale-lock recovery skipped, and every later run on that origin waited out the 30 second deadline and failed. Such a lock is now released once it is older than a short grace period, which still leaves a lock that is only momentarily empty to its live holder.
