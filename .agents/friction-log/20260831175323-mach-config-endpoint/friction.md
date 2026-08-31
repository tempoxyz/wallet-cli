---
title: 'MACH config endpoint had an undocumented external caller'
severity: 'major'
---

## Expected Behavior

Endpoint retirement inventories every released caller before removing the compatibility surface.

## Current Behavior

tempo-wallet hardcoded mach-web.porto.workers.dev/v1/config after Mercator moved to its private MACH binding, so mach-web still looked disposable from the Mercator repositories alone.

## Possible Solution

Add a repository-wide code search and released-client check to the onramp retirement checklist.

## Minimal Reproducible Example

Run `gh search code "mach-web.porto.workers.dev org:tempoxyz"` before retiring mach-web.

## Context

Found while cutting Mercator over to MACH through a private Cloudflare service binding.
