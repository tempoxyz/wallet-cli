---
wallet-cli: patch
---

Fixed `tempo wallet transfer --credits` to report a malformed `request` parameter in an MPP challenge as `E_USAGE`. The parameter was passed straight to `JSON.parse`, so a challenge whose `request` was not base64url-encoded JSON escaped as an uncaught `SyntaxError` and exited 1 under `E_RUNTIME` instead of the exit code 2 every other invalid-challenge check uses. A `request` that decodes to valid JSON that is not an object is rejected the same way, rather than degrading to an empty request and failing later on a missing currency.
