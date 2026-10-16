---
wallet-cli: patch
---

`tempo wallet sessions list` and `sessions close` now show the sessions that earlier releases (the Rust CLI) stored in `~/.tempo/channels.db`, `~/.tempo/sessions.db`, or `~/.tempo/wallet/sessions.db`, so their deposits can be withdrawn. The next session payment or `tempo wallet sessions` command copies them into `~/.tempo/wallet/channels.db`, and copies them again whenever an older CLI changes one of those files, which are otherwise left as they are. When `channels.db` already holds the same channel, a requested close is kept, no deposit or cumulative amount is lowered, and the rest comes from the record used more recently. A close that presto recorded is shown as closing until its grace period ends. A file that cannot be read is reported on stderr and retried later.
