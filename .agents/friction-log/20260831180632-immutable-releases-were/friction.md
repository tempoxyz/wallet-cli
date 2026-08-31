---
title: 'Immutable releases were published before assets were uploaded'
severity: 'blocker'
---

## Expected Behavior

Release binaries, checksums, signatures, SBOMs, and manifests are uploaded before a release becomes immutable.

## Current Behavior

The release workflow published the GitHub release first. Both package publish jobs then failed with HTTP 422 because immutable releases reject asset uploads.

## Possible Solution

Create the release as a draft, upload and distribute every package artifact, then publish the draft in a final job that depends on all publish jobs.

## Minimal Reproducible Example

Run the v0.10.1 Build workflow and inspect the Upload to GitHub Release steps.

## Context

Observed while releasing the tempo-wallet MACH config cutover.
