---
title: 'errors.test.ts scans a hand-written list of src directories for bare Error throws'
severity: 'minor'
issue: 'tempoxyz/wallet-cli#246'
---

## Expected Behavior

The bare `throw new Error(` guard in test/errors.test.ts covers all source under src/, including directories added later.

## Current Behavior

The test walks a fixed list (`src/commands`, `src/payment`, `src/shared`). Moving the request code to a new `src/request/` directory dropped it from the scan without failing anything; the list had to be extended by hand.

## Possible Solution

Walk `src/` recursively (skipping entrypoints if needed) instead of naming directories.

## Minimal Reproducible Example

Add `throw new Error("x")` to a file in a new `src/<dir>/` and run `pnpm test test/errors.test.ts`; it passes.

## Context

Hit while splitting src/commands/request.ts into src/request/.
