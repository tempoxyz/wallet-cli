---
wallet-cli: minor
---

Report typed error codes instead of `UNKNOWN` (exit 1) for invalid `--json` input (`E_USAGE`), missing logins (`E_NOT_AUTHENTICATED`, also on `tempo request` payment paths), funding and session-lock waits (`E_POLL_TIMEOUT`), missing session data (`E_NOT_FOUND`), and submitted transactions whose receipt lacks a hash (`E_PAYMENT_OUTCOME_UNKNOWN`). Transport failures and request timeouts on GET, HEAD, and OPTIONS requests now report `E_NETWORK` with `retryable: true`; other methods stay non-retryable and note that the request may have reached the server. `tempo wallet fund --json-output` errors now include `retryable`.
