---
title: "incur treats explicit boolean values as positional arguments"
severity: "minor"
target: "incur"
---

incur 0.7.1, the command-line parser used by Tempo Wallet CLI, treats the `true` in `transfer --mach true` as a positional argument. `--mach` selects MACH token payment mode, which accepts a payment challenge instead of positional token-transfer arguments, so the extra positional `true` makes the command reject this spelling. `--mach=true` works.

Tempo Wallet CLI works around this in `bindCommandOptions` by rewriting `--mach true` to `--mach=true` and `--mach false` to `--mach=false` before calling incur's parser. Keep this workaround until an incur release parses the separated values as booleans without adding positional arguments.
