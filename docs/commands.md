# Wallet command reference

This list is generated from the mounted command schemas. Run `tempo wallet <command> --help` for argument descriptions and examples. See the [README](../README.md) for the shortest path through the CLI and the [usage guide](usage.md) for payment and recovery behavior.

<!-- generated:commands start -->

- `login`: Sign up or log in to your Tempo wallet. Options: `--no-browser`, `--wait`, `--no-wait`.
- `login status`: Wait for a pending login's approval and finish it. Options: `--interval`, `--max-attempts`.
- `refresh`: Refresh your access key without logging out. Options: `--no-browser`.
- `logout`: Log out of every network, or of one with --network. Options: `--revoke`, `--yes`, `--no-browser`.
- `whoami`: Show who you are: wallet, balances, keys (key.spending_limit is deprecated; use key.spending_limits). Options: `--mach`, `--credits`.
- `balance`: Show the wallet's token balances. Options: `--token`.
- `address`: Show the wallet address. Options: `--qr`.
- `keys list`: List keys and their spending limits (spending_limit is deprecated; use spending_limits).
- `keys update [access-key]`: Update an access key spending limit. Options: `--limit`, `--token`, `--no-browser`.
- `keys revoke <access-key>`: Revoke an access key. Options: `--dry-run`, `--yes`, `--no-browser`.
- `revoke <access-key>`: Deprecated: use 'keys revoke'. Options: `--dry-run`, `--yes`, `--no-browser`.
- `send <amount> <token> <to>`: Send tokens to an address. Options: `--fee-token`, `--dry-run`, `--yes`, `--idempotency-key`, `--address`.
- `transfer [amount] [token] [to]`: Pay an MPP challenge with --mach or --credits. Token transfers moved to 'send'. Options: `--fee-token`, `--dry-run`, `--yes`, `--idempotency-key`, `--mach`, `--credits`, `--max-spend`, `--amount-cents`, `--to`, `--data`, `--mpp-challenge`, `--mpp-challenge-file`, `--mpp-client-id`, `--address`.
- `swap <amount> <token-in> <token-out>`: Swap TIP-20 tokens on the Tempo Stablecoin DEX. Options: `--exact-out`, `--slippage-bps`, `--min-amount-out`, `--max-amount-in`, `--fee-token`, `--dry-run`, `--yes`, `--idempotency-key`.
- `tx status <tx-hash>`: Show a transaction's status on chain.
- `fund`: Open add-funds flows in the wallet app. Options: `--address`, `--no-browser`, `--crypto`, `--mach`, `--credits`, `--amount`, `--referral-code`.
- `funding`: Inspect and reconcile cross-chain funding for paid requests.
- `funding list`: List cross-chain funding that has not been paid with.
- `funding recover <id>`: Check a cross-chain funding operation with its route, without sending anything.
- `sessions`: Manage payment sessions. Options: `--orphaned`, `--all`.
- `sessions list`: List payment sessions. Options: `--orphaned`, `--all`.
- `sessions close [target]`: Request a session close, then withdraw after the grace period with --finalize. Options: `--all`, `--orphaned`, `--finalize`, `--cooperative`, `--dry-run`, `--yes`.
- `sessions sync`: Sync local sessions with on-chain state. Options: `--origin`.
- `services`: Browse the MPP service directory. Options: `--refresh`.
- `services list`: List every service in the MPP service directory. Options: `--refresh`.
- `services search <query>`: Search services by name, id, description, tags, or category; every word must match. Options: `--refresh`.
- `services show <service-id>`: Show a service's endpoints, prices, and docs. Options: `--refresh`.
- `mcp add`: Register as MCP server. Options: `--agent`, `--command` (`-c`), `--no-global`.
- `skills add`: Sync skill files to agents. Options: `--depth`, `--no-global`.
- `skills list`: List skills.
- `config get [key]`: Show each setting's effective value and where it comes from.
- `config set <key> <value>`: Save a setting for later commands. Options: `--yes`.
- `config unset <key>`: Remove a saved setting. Options: `--yes`.
- `doctor`: Diagnose login, access key, RPC, sqlite3, and environment setup.
- `debug`: Deprecated: use 'doctor'.
- `completions [bash|zsh|fish|nushell|powershell|elvish]`: Generate shell completions script.

Global options: `--network` (`-n`), `--verbose` (`-v`), `--silent` (`-s`), `--json-output` (`-j`), `--toon-output` (`-t`), `--filter-output`, `--format`, `--full-output`, `--help`, `--llms`, `--llms-full`, `--mcp`, `--schema`, `--token-count`, `--token-limit`, `--token-offset`, and `--version`.

<!-- generated:commands end -->
