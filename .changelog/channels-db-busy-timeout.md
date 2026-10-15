---
wallet-cli: patch
tempo-request: patch
---

Commands that read or write stored payment sessions now wait up to 5 seconds for another CLI process's lock on `channels.db` instead of failing at once with "database is locked". Parallel `tempo request` calls, or `tempo wallet sessions` during a paid request, could fail this way, most often while the first run created or migrated the database, and `tempo wallet whoami` could report no session funds.
