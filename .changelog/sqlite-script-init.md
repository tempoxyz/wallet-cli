---
wallet-cli: patch
---

Importing sessions from legacy session databases no longer reads the user's `~/.sqliterc`, whose `.bail off` could let a failed import commit part of its changes.
