---
wallet-cli: minor
---

Select the network the same way for every `tempo wallet` and `tempo request` command: `--network`/`-n`, then `TEMPO_WALLET_NETWORK`, then the logged-in wallet's network, then mainnet. After `tempo wallet login -n testnet`, commands such as `whoami`, `transfer`, `swap`, `sessions`, `debug` and `tempo request` now stay on testnet instead of falling back to mainnet. `--network` is a CLI-wide option that may appear before or after the command, and MCP tools still accept a `network` argument. `keys update` and `revoke` reject a network that differs from the logged-in wallet's.

JSON output for `whoami`, `whoami --mach`, `debug`, `transfer`, `swap`, `revoke`, `keys update`, `fund` and `sessions list` now includes `chain_id` and `network`. `keys list` labels each key, and queries its balance, from the key's own chain and wallet, and filters by `--network` or `TEMPO_WALLET_NETWORK` when either is set. `_next` continuations always end with `--network` set to the network the command resolved.
