---
wallet-cli: minor
---

`tempo wallet logout --network <network>` (or `TEMPO_WALLET_NETWORK`) logs out of that network only: it removes the network's access keys and a pending login for it, keeps the wallet while it still has its own keys on another network, and moves the wallet's network there. Without a network, logout still logs out of every network and now reports `scope: "all"`.

`--revoke` revokes each removed key on-chain through the wallet app before removing it, on the network the wallet is logged in on; a logout that also covers keys on another network is refused with `E_USAGE` naming the network logout to run first. A key the chain does not show revoked is kept with the wallet, and the command fails naming it. Without `--revoke`, the output notes that removed keys stay authorized on-chain until they expire.

Logout now lists stored sessions on the networks it logs out of (on every network when it removes the wallet) that still hold unspent deposits, with an `instruction` and `_next` naming the `tempo wallet sessions close --all` (or `--finalize`) that withdraws them after logging in again. Such a logout, and any `--revoke`, needs confirmation: a `[y/N]` prompt in a terminal, or `--yes`, which until now did nothing. A session store that exists but cannot be read, because sqlite3 is not installed or the database is corrupt, needs the same confirmation, so `--yes` still logs out. An agent run, or one whose stdin is not a terminal, without `--yes` fails with `E_USAGE` and a `cta` that adds it. `--no-browser` is accepted for `--revoke`.

`tempo wallet sessions list` (and logout's `sessions`) now count a session's `spent` as its highest signed, accepted, or server-reported amount, as `whoami` does, so `remaining` no longer overstates a session whose latest voucher was never acknowledged.

**Output change:** logout's `logged_in` field, which meant "was logged in", is renamed `was_logged_in`. The output also adds `scope`, `keys`, and `sessions`.
