---
title: "pnpm check rewrites CHANGELOG.md and a friction entry on main"
severity: "minor"
---

## Expected Behavior

`pnpm check` on a clean checkout of main leaves the tree clean.

## Current Behavior

`vp check --fix` rewrites CHANGELOG.md (trailing spaces) and .agents/friction-log/20260831180632-immutable-releases-were/friction.md (quote style), so every run leaves a dirty tree that must be reverted before committing.

## Possible Solution

Commit the formatted versions, or have frog write double-quoted frontmatter.

## Minimal Reproducible Example

git checkout main && pnpm check && git status

## Context

Found while checking every commit of brendan/machine-fetch with git rebase --exec.
