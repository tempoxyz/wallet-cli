# Changelogs

This folder contains changelog files that describe changes to release.

## Adding a changelog

Add a markdown file under `.changelog/` with YAML frontmatter:

```markdown
---
wallet-cli: patch
---

Description of the change.
```

Supported bump levels are `patch`, `minor`, `major`, and `none`.

The release is versioned as one package, `wallet-cli`, and publishes both `tempo-wallet` and `tempo-request` from the same tag. Changelog entries may also use `tempo-wallet` or `tempo-request` in frontmatter when a change is scoped to one binary; any non-`none` bump still advances the shared version.

## Releasing

When changes land on `main`, the release workflow consumes pending `.changelog/*.md` files, opens or updates a release PR, bumps `package.json`, prepends `CHANGELOG.md`, and removes consumed entries.

When that release PR is merged, the workflow creates a `vX.Y.Z` GitHub release/tag. The existing tag-driven build workflow then publishes signed binaries and manifests.
