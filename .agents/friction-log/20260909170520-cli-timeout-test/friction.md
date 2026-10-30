---
title: 'CLI timeout test includes TypeScript process startup'
severity: 'minor'
issue: 'tempoxyz/wallet-cli#139'
---

## Expected Behavior

The CLI deadline test measures request time independently of process startup.

## Current Behavior

CI startup took roughly 3.3 seconds and exceeded the 2.5-second assertion in test/request-io.test.ts.

## Possible Solution

Start timing when the local server receives the request; retain the exit-code and single-request assertions.

## Minimal Reproducible Example

Run pnpm test on a CI runner with slow Node/tsx startup.

## Context

Observed in PR #137, CI run 34253485246.
