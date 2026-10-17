---
tempo-wallet: minor
---

**Breaking:** legacy `transfer` and `fund` flags are retired. Each fails with `E_USAGE` naming what replaces it before the command parses its options or runs, so nothing is sent, and its `cta` is the equivalent command when the run's arguments give one and it is the only retired flag given. `--value` is removed from `transfer`, since transfers carry no ETH value; for a zero value the `cta` is the same run without it. `transfer --mach --amount-cents <cents>` is removed, whatever its value; for whole cents the `cta` passes the same cap in USD with `--max-spend`. `fund --claim <code>` is removed; the `cta` passes the code with `--referral-code`. A token transfer, `send` or `transfer` without `--credits` or `--mach`, now refuses `--to`, `--data`, and `--amount-cents` instead of ignoring them, and the `cta` for `--to` passes the recipient as the third argument of `send`.

`transfer --credits` keeps `--to`, `--data`, and `--amount-cents`, which are still the only way to spend legacy MPP Credits. The MCP `transfer` and `fund` tools keep `value` and `claim` in their input schemas for one release, described as removed and refused with the same message, even when `false`. `transfer` refuses `amount-cents` with `mach`, and `data` or `amount-cents` on a token transfer, so no client has an argument silently dropped.
