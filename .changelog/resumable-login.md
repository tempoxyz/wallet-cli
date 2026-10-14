---
wallet-cli: minor
---

Split `tempo wallet login` across processes. An agent run (MCP, `--format`, or output that is not a terminal) now returns at once with `status: "pending"`, `verification_url`, `user_code`, `expires_at`, and a `_next` naming the new `tempo wallet login status`, which waits for the wallet's approval (`--interval`, `--max-attempts`) and finishes the login. A terminal run still waits; `--wait` and `--no-wait` override either default. The pending login is saved with mode 0600 next to the wallet store, replaced by a new `login`, and cancelled by `logout`; a `login status` whose code was replaced or cancelled meanwhile stops with `E_USAGE` and discards a late approval.

Login now waits until the device code expires instead of stopping after five minutes, and reports its outcomes with typed errors instead of `UNKNOWN`: `E_LOGIN_DENIED` and `E_LOGIN_EXPIRED` name `tempo wallet login`, while `E_POLL_TIMEOUT` and `E_NETWORK` (also for HTTP failures from the wallet) are retryable and name the same `login status` (#149).
