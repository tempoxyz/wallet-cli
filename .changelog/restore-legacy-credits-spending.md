---
wallet-cli: patch
---

Restore spending existing MPP Credits with `transfer --credits` and viewing their balance with `whoami --credits`, with deprecation warnings. Reject `fund --credits` and direct users to `fund --mach` to buy MACH.

Honor `TEMPO_MAX_SPEND` for legacy credit payments and reject direct-transfer options alongside a challenge. Prefer MACH for supported charges and allow mppx to fall back to the advertised currency when MACH is unavailable.

Parse credit challenges with mppx, reject invalid expiry and unsupported splits, show payment details in dry runs, and validate credit permits and fee-inclusive spending caps before signing.
