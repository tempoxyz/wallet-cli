---
wallet-cli: minor
---

Return `instruction` and `_next` (`argv`, a POSIX-quoted `command`, and optional `until` and `poll_interval_seconds`) on multi-step `tempo wallet` results: `swap`, `transfer`, and `revoke` dry runs point at the submitting command, a pending `sessions close` points at the withdrawal after the grace period, and `keys update` and a fresh `login` point at the command that confirms the result. The continuation repeats the selected `--network`.
