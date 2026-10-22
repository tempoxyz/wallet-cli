# Releasing the wallet and request extensions

`scripts/package.ts` builds exactly two products: `tempo-wallet` and `tempo-request`.
Each ships Linux and macOS binaries for x64 and arm64. A shared `vX.Y.Z` release
publishes both. The Rust Tempo launcher and the wallet web/mobile apps are separate
products; this script does not build them.

## Runtime security

Standalone executables embed Node; upgrading the user's installed Node or only
`actions/setup-node` does not patch them. Packaging uses `@yao-pkg/pkg --sea` with
the official, checksum-verified Node release pinned in `.node-version`, rather
than pkg-fetch's custom Node binaries. Node 22.23.4 includes the October 2026
security fixes, including CVE-2026-111497.

The esbuild `--target=node22` option controls JavaScript syntax only. The packaging
script converts legacy `node22-<os>-<arch>` targets to the pinned exact version,
rejects other runtime versions, and adds a startup check for the embedded runtime.
Update `.node-version` when applying future Node security releases.

SEA changes the executable format. Before release, require the full build matrix
and smoke checks for both products on all four targets, including native Intel
macOS. Smoke checks cover the runtime guard, version/help/command metadata, wallet
configuration, and a local Brotli-compressed response through tempo-request.
These are compatibility checks, not an exploit reproduction or a full wallet
payment end-to-end test.

## Pre-release validation

1. Keep the security change's patch changelog entry. Run `pnpm check`,
   `pnpm docs:check`, and `pnpm changelog:validate`.
2. Push the proposed branch and run a build-only dispatch (replace `BRANCH`):

   ```sh
   gh workflow run build.yml --repo tempoxyz/wallet-cli --ref BRANCH
   ```

   Omit `release_tag`: the workflow builds both products from the branch and skips
   the publishing jobs because the parsed ref starts with `refs/heads/`.
   Require all eight matrix builds, smoke checks, checksums, SBOMs, and
   attestations to succeed before proceeding.

3. Run the normal wallet/payment release QA against the candidate binaries in the
   intended test environment before publishing. Review all changes since the last
   published tag, not just the security PR.
   Main may include unreleased features. If those are not ready, prepare a
   reviewed security backport from the last release and validate that exact source
   instead of treating a main-branch release as a security-only update.

## Publish both products

1. Merge the reviewed security PR only after its validation passes. The Release
   workflow consumes pending changelogs and updates the shared version in the
   `changelog-release/main` PR. Verify it contains the security fix and the desired
   release notes/version. Do not assume a patch entry makes an existing minor
   release PR into a patch release.
2. Approve release-environment gates only when ready to publish. **Merging the
   generated release PR can start publication automatically.** The workflow
   creates a `vX.Y.Z` tag and draft GitHub release, then dispatches Build with
   `release_tag=vX.Y.Z`. No separate tag push or second per-product release is
   needed.
3. Follow the dispatched Build run: all eight builds must pass before publishing.
   It uploads binary assets/checksums/SBOMs/Sigstore bundles, signs both extension
   manifests, uploads immutable `extensions/<package>/vX.Y.Z/` objects to R2, then
   updates each package's current manifest and `VERSION`. It publishes the draft
   GitHub release after both package publish jobs succeed.
4. Verify the published GitHub assets and both served extension manifests at
   `https://cli.tempo.xyz/extensions/tempo-wallet/manifest.json` and
   `https://cli.tempo.xyz/extensions/tempo-request/manifest.json`. Check each
   manifest's version, signatures, artifact URLs and checksums, then test a fresh
   launcher installation and confirm both CLI versions and wallet doctor's Node
   version.

If a dispatch must be resumed, first inspect the existing run and draft release;
then use `gh workflow run build.yml --repo tempoxyz/wallet-cli --ref main -f
release_tag=vX.Y.Z` only for the intended existing tag. Rebuilding an old tag builds
its old source, so it does not incorporate this fix. Use a new version for changed
binaries: immutable versioned R2 objects reject different bytes at the same URL.
The two package publish jobs are not atomic; verify both current manifests after
any partial failure, and investigate before retrying or changing release pointers.
