---
title: "Fund compatibility path ignores unknown options"
severity: "major"
---

## Expected Behavior

The fund compatibility path rejects unrecognized options so removed or misspelled funding flags cannot silently trigger the default funding flow.

## Current Behavior

`handleCompatCommand` intercepts every non-help `fund` invocation and manually reads known arguments without rejecting unknown options.

## Possible Solution

Validate fund arguments before calling `runFundingFlow`, or delegate parsing to the normal command schema while preserving compatibility output.

## Minimal Reproducible Example

Run `tempo wallet fund --not-a-real-option --no-browser` with a configured wallet and observe that the default funding flow starts.

## Context

Found while removing an unsupported legacy funding option.
