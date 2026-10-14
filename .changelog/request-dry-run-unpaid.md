---
tempo-request: minor
---

`--dry-run` on a URL that does not answer 402 now prints `{ payment_required: false, status, probe_sent: true }` instead of the response body, and never writes the body to stdout or `-o`. Methods other than GET, HEAD, and OPTIONS add a `warning` that the request was sent and may have had side effects. `--dry-run` help now says the request is sent to discover the payment challenge.
