---
title: "runSql keeps running a script after a statement fails, so BEGIN ... COMMIT can commit part of it"
severity: "minor"
---

## Expected Behavior

A multi-statement script passed to `runSql`/`querySql` (src/shared/process.ts) stops at the first failing statement, so a `BEGIN; ...; COMMIT;` script either applies whole or not at all, and the rejection names the statement that failed.

## Current Behavior

The sqlite3 shell runs the SQL argument's later statements after one fails at run time, and `-bail` does not change that for a command-line argument. A script `BEGIN IMMEDIATE; INSERT <conflicting row>; INSERT <marker>; COMMIT;` exits 1 but commits the marker. A failed `ATTACH` of a file that is not a database prints nothing, so the rejection names the next statement instead (`no such table: legacy.sqlite_master`).

## Possible Solution

Feed scripts to sqlite3 on stdin with `-bail`, which does stop at the first failing statement. `runSqlScript` now does this for the legacy session import; `runSql` could do the same, or be limited to single statements.

## Minimal Reproducible Example

`sqlite3 t.db "CREATE TABLE t (id INTEGER PRIMARY KEY); CREATE TABLE m (x); INSERT INTO t VALUES (1);"`, then `sqlite3 -bail t.db "BEGIN IMMEDIATE; INSERT INTO t VALUES (1); INSERT INTO m VALUES (1); COMMIT;"` exits 1, and `SELECT COUNT(*) FROM m` is 1.

## Context

Hit while copying legacy session databases into channels.db.
