---
tempo-wallet: minor
---

Add `tempo wallet doctor`, which reports the setup on the resolved network: CLI, Node, incur, and accounts SDK versions; the stored wallet and its type; the access key's status, expiry, and spending limits; whether the RPC answers `eth_chainId` on the expected chain, and how fast; the wallet app URL; sqlite3; the session store; and which environment overrides are set. Each finding is an `ok`, `warn`, or `fail` check, and `_next` names the `tempo wallet login` or `tempo wallet refresh` that fixes the most important problem. Checks run concurrently with their own deadlines, an unhealthy setup still exits 0, and secrets never appear: `TEMPO_PRIVATE_KEY` is reported only as set, and URL credentials, paths, and queries are redacted.

`tempo wallet debug` is deprecated: it prints a notice on stderr and returns the `doctor` report, replacing its previous output, which reported every wallet as a passkey and versions as `(local)`.
