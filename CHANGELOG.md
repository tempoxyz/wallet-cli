# Changelog

## 0.6.1 (2026-06-19)

### Patch Changes

- Add changelog enforcement, generation, release PR automation, and automatic tag creation for future wallet-cli releases.
- Make release PR updates detect existing `changelog-release/main` pull requests reliably before attempting to create a new one.
- Allow changelog-generated commits and release PR updates to use a configured `GH_PAT`, so automation-created branches can trigger normal CI when the token is available.
- Fix `tempo request` handling for services that return both Tempo `WWW-Authenticate` challenges and x402 `payment-required` descriptors, and extend refreshed wallet access keys to 30 days.

## 0.6.0 (2026-06-18)

### Minor Changes

- Add packaged `tempo request` support alongside `tempo wallet`, update both CLIs for current SDKs, and publish signed extension manifests through the Tempo launcher update path.

### Patch Changes

- Harden v2 session flows for descriptor persistence/reuse, top-up, close/finalize, key authorization rehydration, and live wallet balance/session reporting.
