---
title: "Anvil 1.8.1 never answers an access-key transaction over its spending limit"
severity: "minor"
target: "foundry-rs/foundry"
---

## Expected Behavior

`eth_sendRawTransactionSync` on `anvil --network tempo` rejects an access-key transaction that exceeds the key's spending limit, as Anvil 1.8.4 does (`SpendingLimitExceeded`).

## Current Behavior

Anvil 1.8.1, which machine-fetch's `test/e2e/compose.yaml` pins, never answers: the request times out. A fee paid in a token outside the key's limits triggers it too, so it looks like a hung DEX swap.

## Possible Solution

Pin 1.8.4 or later (test/e2e/compose.yaml does), and give test keys a limit for their fee token.

## Minimal Reproducible Example

Send an approve + Stablecoin DEX buy from an access key whose limits leave out the fee token.

## Context

Found building the wallet-cli e2e harness.
