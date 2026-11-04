---
wallet-cli: none
---

Release builds no longer rerun types and the full test suite in each of the eight binary jobs; one verify job runs them once per platform while the binaries build, and the release signer is built once instead of in each publish job.
