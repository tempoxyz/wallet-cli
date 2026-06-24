# Changelog

## 0.6.3 (2026-06-24)

### Patch Changes

- Fix `tempo request --no-proxy` so it disables proxy use instead of being parsed as an invalid negation of `--proxy`.

## 0.6.2 (2026-06-23)

### Patch Changes

- Show all stored access key limits, periods, scopes, and local key status in wallet key output.
- Automatically dispatch the build and publish workflow after creating a release tag, so release assets and extension manifests publish without manual intervention.
- Migrate legacy `keys.toml` wallet state into the new `store.json` format on first run.
- Fix `tempo wallet login --no-browser` and `tempo wallet fund --no-browser` option parsing.
- Update production dependencies and pin transitive WebSocket dependencies to patched advisory ranges.
- Harden wallet store writes so local key material is saved under private file and directory permissions.
- Keep local CLI version output aligned with the package version.
- Add a wallet command to revoke access keys and remove revoked local key state.
- Align generated wallet command metadata for service discovery and integration schema requests.

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
