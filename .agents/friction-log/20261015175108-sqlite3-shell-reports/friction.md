---
title: "sqlite3 shell reports the next statement's error after a failed ATTACH in runSql"
severity: "minor"
---

## Expected Behavior

A multi-statement script passed to runSql/querySql (src/shared/process.ts) fails with the error of the statement that failed, such as 'file is not a database' for an ATTACH of a corrupt file.

## Current Behavior

The sqlite3 shell keeps running the argument after an ATTACH fails at run time, without printing that error, so the rejection names a later statement instead: 'no such table: legacy.sqlite_master'. Prepare errors stop the script; run-time errors do not.

## Possible Solution

Pass -bail in runSqlite, or inspect a second database by opening it directly, as queryReadOnlySql does, rather than through ATTACH.

## Minimal Reproducible Example

Write any text to bad.db, then run: sqlite3 -json main.db "ATTACH 'file:bad.db?mode=ro' AS legacy; SELECT name FROM legacy.sqlite_master;" It prints only the 'no such table' error.

## Context

Hit while migrating legacy session databases into channels.db.
