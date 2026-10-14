---
wallet-cli: minor
---

`tempo wallet fund` waits for the funds by default and now finishes honestly. It prints the funding URL before reading the starting balance, so an RPC failure no longer hides it, and builds the URL from `TEMPO_AUTH_URL` like the rest of the CLI. Results report `received` (the increase over the starting balance) with the watched `token` and `symbol`; a requested `--amount` completes only once the full amount arrives. Referral claims (`--claim`/`--referral-code`) return the pending handoff immediately instead of watching USDC.e for a payout the CLI cannot identify.

`--no-wait` handoffs and timeouts include `_next`: a status check, `fund ... --baseline <raw balance> --no-wait`, that reads the balance once against the recorded baseline, with `until: '.status == "success"'` and `poll_interval_seconds`. A timeout now exits 3 with `status: "timeout"`, the `url`, and that `_next` instead of an `E_POLL_TIMEOUT` error carrying the URL only in its message.
