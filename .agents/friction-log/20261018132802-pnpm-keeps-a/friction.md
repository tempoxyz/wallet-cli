---
title: "pnpm keeps a file: dependency's old copy after re-vendoring, even with --force"
severity: "minor"
---

## Expected Behavior

Re-running scripts/vendor.sh is enough for tests and bundles to use the new vendored build.

## Current Behavior

pnpm copies file: directory dependencies into node_modules and keeps the previous build: neither `pnpm install` nor `pnpm install --force` refreshes it. Only deleting node_modules and installing again does.

## Possible Solution

scripts/vendor.sh says to delete node_modules and reinstall afterwards; it could do it itself.

## Minimal Reproducible Example

Re-vendor machine-fetch at a new commit, run `pnpm install --force`, and read node_modules/machine-fetch/package.json.

## Context

vendor/ added for the machine-fetch integration.
