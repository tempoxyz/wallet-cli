---
title: "walletError cause option appends the cause message to message"
severity: "minor"
---

## Expected Behavior

`walletError({ code, message, cause })` in src/shared/errors.ts keeps `message` as given, so a site can attach the underlying error without changing the text that users, tests, and callers matching on `error.message` see.

## Current Behavior

incur's `BaseError` sets `message` to `${shortMessage}\n\nDetails: ${cause.message}` whenever `cause` is an `Error`, so passing `cause` changes the reported message. A spawn failure typed with `cause: error` reported `Failed to run sqlite3 for the lock at <path>: spawn sqlite3 EACCES`, then a blank line and `Details: spawn sqlite3 EACCES`, repeating the cause and breaking exact-message matches.

## Possible Solution

Say on `walletError` that `cause` appends `Details: <cause message>` to `message`, with the given text kept on `shortMessage`, or let callers attach a cause without changing `message`.

## Minimal Reproducible Example

`walletError({ code: "E_RUNTIME", message: "failed", cause: new Error("boom") }).message` is `"failed\n\nDetails: boom"`.

## Context

Hit while replacing bare `Error` rejections in src/payment/session-lock.ts with typed errors that keep their message text.
