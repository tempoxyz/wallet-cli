---
wallet-cli: patch
---

`sqlite3` failures now report `E_RUNTIME` (exit 1) with the same message, instead of `UNKNOWN`. This covers a lock that `sqlite3` cannot start for or cannot take, used by session payments, `config`, login, and `--idempotency-key` sends, and a session store query that fails, used by `sessions` and session payments. A lock whose `sqlite3` cannot start for a transient reason (`EAGAIN`, `EMFILE`, `ENFILE`, `ENOMEM`), and a session store another process held past the busy timeout, are retryable. Under `tempo request --payment-intent session`, or `auto` when no one-time charge fits, a session store failure reports `E_RUNTIME` (exit 1) instead of `E_PAYMENT` (exit 4). `--payment-intent auto` still offers a fitting one-time charge for these failures, and `--dry-run` still reports a session the store cannot be read for as `null`.
