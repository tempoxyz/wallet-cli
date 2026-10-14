---
wallet-cli: minor
---

`tempo wallet transfer` (token and `--mach` payments), `swap`, `keys update`, `revoke`, and `sessions close`, dry runs included, now check for a logged-in wallet with a usable access key on the selected network before doing anything else. A missing login returns `E_NOT_AUTHENTICATED`, an expired key `E_KEY_EXPIRED`, and a missing or unusable key `E_AUTH_REFRESH_REQUIRED` (exit 4), each with a `cta` naming `tempo wallet login --network <network>` or `tempo wallet refresh --network <network>`, which MCP tool errors also include. These commands previously reported `E_USAGE` "Configuration missing" or an error without a command, started a login (`--mach`) or a wallet app approval (expired key) instead of failing, and `swap --dry-run` without a usable key returned a quote. `keys update` without an access key argument now updates the key the CLI pays with. `transfer --credits` and `transfer --mach` paid by `TEMPO_PRIVATE_KEY` still run without one.
