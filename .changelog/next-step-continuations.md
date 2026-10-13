---
wallet-cli: minor
---

Return `instruction` and `_next` (`argv`, a POSIX-quoted `command`, and optional `until` and `poll_interval_seconds`) on multi-step `tempo wallet` results: `swap`, `transfer`, and `revoke` dry runs point at the submitting command, a pending `sessions close` points at the withdrawal after the grace period, and `keys update` and a fresh `login` point at the command that confirms the result. The continuation repeats the selected `--network`.

`tempo wallet swap` accepts `--min-amount-out` (exact input) and `--max-amount-in` (`--exact-out`): the submitted bound is the stricter of the slippage bound and the reviewed one, a fresh quote that cannot meet it is refused with `E_LIMIT_EXCEEDED`, and the dry-run continuation pins the reviewed bound.
