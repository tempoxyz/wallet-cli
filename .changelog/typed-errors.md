---
wallet-cli: minor
---

Report typed error codes instead of `UNKNOWN` (exit 1) for invalid `--json` input (`E_USAGE`), missing logins (`E_NOT_AUTHENTICATED`), funding and session-lock waits (`E_POLL_TIMEOUT`, retryable), missing session data (`E_NOT_FOUND`), and submitted transactions whose receipt lacks a hash (`E_PAYMENT_OUTCOME_UNKNOWN`). `tempo wallet fund --json-output` errors now include `retryable`.
