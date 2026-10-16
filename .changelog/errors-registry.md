---
wallet-cli: none
---

Keep the error code registry and generic error constructors in `src/shared/errors.ts`, move the access key limit error next to the access key code, and move `CtaError` and `ctaErrors` into the incur compat module. No user-facing change.
