---
wallet-cli: none
---

Release builds no longer rerun types and the full test suite in each of the eight binary jobs; one sharded verify job runs them once while the binaries build, and the release signer is built once instead of in each publish job.
