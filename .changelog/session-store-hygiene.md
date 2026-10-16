---
wallet-cli: patch
---

Sessions that earlier releases (the Rust CLI) stored in `~/.tempo/channels.db`, `~/.tempo/sessions.db`, or `~/.tempo/wallet/sessions.db` are now moved into `~/.tempo/wallet/channels.db` the next time a session payment or a `tempo wallet sessions` command opens the store, so `sessions list` and `sessions close` show them and can withdraw their deposits. When `channels.db` already holds the same channel, the record used more recently wins, and no deposit or cumulative amount is lowered. Each old database is kept, renamed to `<name>.migrated` along with its WAL files. A database that cannot be moved stays in place with a warning on stderr, and is retried on the next run.

Session lock files no longer pile up in `~/.tempo/wallet/`. Taking a session lock now first deletes the locks that `tempo request` processes killed mid-payment left for any origin, and the `payment_<origin>.lock` files the Rust CLI created for every origin it paid and never deleted, once no process holds them; the latter needs `perl`, and without it those files are kept. A lock that a running process holds is never deleted. Before, two requests that found the same abandoned lock could each delete the lock the other had just taken, and pay the same origin at once.
