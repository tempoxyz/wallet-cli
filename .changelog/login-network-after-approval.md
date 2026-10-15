---
wallet-cli: patch
---

`tempo wallet login`, `tempo wallet login status`, and `tempo wallet refresh` with `--network` switch the wallet's stored network only once the wallet app approves. Previously the network was saved as soon as the request started, so a login or refresh on another network that was denied, expired, timed out, was left pending, or was interrupted still moved every later command without `--network` to that network.
