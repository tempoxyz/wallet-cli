---
wallet-cli: patch
---

Restore spending existing MPP Credits with `transfer --credits` and viewing their balance with `whoami --credits`, with deprecation warnings. Reject `fund --credits` and direct users to `fund --mach` to buy MACH.

Honor `TEMPO_MAX_SPEND` for legacy credit payments, require a cap for challenge spending, and reject conflicting positional or direct-transfer arguments.

Bound credit challenge input before parsing with mppx, reject malformed or expired challenges and unsupported splits or pull-only payments, show payment details in dry runs, and validate credit permits and fee-inclusive spending caps before signing. Recheck challenge expiry before redemption, time out stalled credit-service requests, and report uncertain redemptions without retrying. Escape terminal controls and bound server error details.
