---
wallet-cli: patch
---

`--help` and `--describe` say that `--max-spend` caps a MACH payment in MACH (1 MACH = 1 USD) for `tempo request`, `config set max-spend`, and `transfer --mach`, and that `send` and `transfer` `--address` is a guard that must match the paying wallet, except with `transfer --credits`, where it names the wallet whose credits to spend.
