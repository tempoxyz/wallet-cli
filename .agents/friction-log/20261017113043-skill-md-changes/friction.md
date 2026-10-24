---
title: 'SKILL.md changes need a changelog entry, but only the Changelog workflow says so'
severity: 'minor'
issue: 'tempoxyz/wallet-cli#270'
---

## Expected Behavior

`.changelog/README.md`, or the README's Contributing section, says which changes need a changelog entry, so a docs-only pull request knows whether to add one before CI runs.

## Current Behavior

Neither says. The Changelog workflow (`.github/workflows/changelog.yml`) exempts only `.changelog/`, `.github/`, `.gitignore`, `README.md`, `AGENTS.md`, and `LICENSE`, so a pull request that edits `SKILL.md`, which ships with each `tempo-request` release, fails without an entry, while one that edits only `README.md` passes without one. That rule is found only by reading the workflow or an earlier entry such as `.changelog/skill-wallet-url.md`.

## Possible Solution

State the rule in `.changelog/README.md`: every change outside the exempt paths needs an entry, including `SKILL.md`, and a `README.md`-only change does not.

## Minimal Reproducible Example

Open a pull request that changes one line of `SKILL.md` and adds no `.changelog/*.md`: the Changelog check fails with "A changelog entry is required for this PR."

## Context

Hit while updating `README.md` and `SKILL.md` prose for the commands added in one release.
