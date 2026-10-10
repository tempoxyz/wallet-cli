---
title: 'Release workflows fail during Corepack pnpm bootstrap'
severity: 'blocker'
---

## Expected Behavior
Release workflows install the pinned pnpm version and continue to release creation.

## Current Behavior
Corepack fails downloading pnpm 11.0.8 in both release attempts. The same failure reproduces locally with a clean Corepack cache.

## Possible Solution
Use the pinned pnpm setup action already used by CI. Its installer succeeds locally with pnpm 11.0.8.

## Minimal Reproducible Example
Run Corepack prepare for pnpm 11.0.8 with an empty cache.

## Context
https://github.com/tempoxyz/wallet-cli/actions/runs/38009723353/job/114087469356
