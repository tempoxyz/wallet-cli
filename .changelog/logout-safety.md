---
wallet-cli: minor
---

`tempo wallet logout --network <network>` (or `TEMPO_WALLET_NETWORK`) logs out of that network only: it removes the network's access keys and a pending login for it, keeps the wallet while another network still has keys, and moves the wallet's network there. Without a network, logout still logs out of every network and now reports `scope: "all"`.

`--revoke` revokes each removed key on-chain through the wallet app before removing it, on the network the wallet is logged in on; a logout that also covers keys on another network is refused with `E_USAGE` naming the network logout to run first. A key the chain does not show revoked is kept with the wallet, and the command fails naming it. Without `--revoke`, the output notes that removed keys stay authorized on-chain until they expire.

Logout now lists stored sessions on the networks it logs out of that still hold unspent deposits, with an `instruction` and `_next` naming the `tempo wallet sessions close --all` (or `--finalize`) that withdraws them after logging in again. Such a logout, and any `--revoke`, needs confirmation: a `[y/N]` prompt in a terminal, or `--yes`, which until now did nothing. An agent run, or one whose stdin is not a terminal, without `--yes` fails with `E_USAGE` and a `cta` that adds it. `--no-browser` is accepted for `--revoke`.

**Output change:** logout's `logged_in` field, which meant "was logged in", is renamed `was_logged_in`. The output also adds `scope`, `keys`, and `sessions`.
