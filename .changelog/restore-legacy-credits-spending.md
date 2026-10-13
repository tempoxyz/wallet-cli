---
wallet-cli: patch
---

Restore spending existing MPP Credits with `transfer --credits` and viewing their balance with `whoami --credits`, with deprecation warnings. Reject `fund --credits` and direct users to `fund --mach` to buy MACH.

Honor `TEMPO_MAX_SPEND` for legacy credit payments and reject direct-transfer options alongside a challenge. Preserve existing currency selection: default charges use mppx fallback, while explicit `--mach` requires MACH.

Bound credit challenge input before parsing with mppx, reject malformed or expired challenges and unsupported splits or pull-only payments, show payment details in dry runs, and validate credit permits and fee-inclusive spending caps before signing. Escape terminal controls and bound server error details.
