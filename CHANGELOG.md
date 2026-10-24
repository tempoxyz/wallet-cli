# Changelog

## 0.15.1 (2026-10-24)

### Patch Changes

- Updated Undici and Zod dependencies to patched versions and upgraded the development test tooling to resolve security advisories.

## 0.15.0 (2026-10-23)

### Minor Changes

- Add `tempo wallet balance [--token <symbol|address>]` and `tempo wallet address [--qr]`. `balance` prints the logged-in wallet's token balances on the resolved network as `{ wallet, chain_id, network, balances: [{ token, symbol, decimals, balance, verified }] }`: each token the wallet app reports, plus the network's default token (USDC.e on mainnet, pathUSD on testnet) read on chain even at zero. `--token` shows only that token, read on chain in its own decimals. A failed on-chain read returns retryable `E_NETWORK`, unless the wallet app reported that token, whose balance is then shown. Session deposits are held in escrow, so locked and pending-refund amounts stay in `whoami`. `address` prints `{ address, chain_id, network }`; on a terminal, `--qr` also draws a QR code of the address for receiving funds, while agent and JSON output stay the same. Both need a login but no access key, return `E_NOT_AUTHENTICATED` with a login `cta` without one, and are read-only MCP tools; `address` makes no network request.
- Added `tempo wallet config get [key]`, `config set <key> <value>`, and `config unset <key>`, which save `network`, `rpc-url`, and `max-spend` in `~/.tempo/wallet/config.json`, readable only by you. A command's flag, then the setting's environment variable (`TEMPO_WALLET_NETWORK`, `TEMPO_RPC_URL`, or `TEMPO_MAX_SPEND`), still beats the saved value, which beats the built-in default. `config get` reports each setting's effective `value` and its `source` (`flag`, `env`, `config`, `login`, or `default`), showing `rpc-url` redacted as `doctor` does. An unknown key fails with `E_USAGE` listing the valid ones, and a config file that is not valid fails the commands that read it with `E_USAGE` naming the file; `doctor` reports it instead. Each command, or MCP tool call, reads the config file once, so it uses one set of settings throughout, and a change saved meanwhile applies to the next command.

  A saved `network` also beats the logged-in wallet's network, as `TEMPO_WALLET_NETWORK` does, so commands stay on it after a `login --network` elsewhere until you pass `--network` or change the setting. It does not narrow `keys list` or `logout`, which still cover every network unless `--network` or `TEMPO_WALLET_NETWORK` selects one. A saved `max-spend` must be positive and counts as an explicit cap, like `TEMPO_MAX_SPEND`: it allows MACH payments and refuses subscription offers.

  `rpc-url` is saved per network, as `{ "rpc-url": { "mainnet": ..., "testnet": ... } }`: `config set` and `config unset` change it for `--network`, else the network commands use, `config get` shows each network's, and a network's RPC calls use only its own. `config set rpc-url` first asks the URL's `eth_chainId` (3 seconds, no retries) and saves it only on that network's chain, refusing an endpoint on another chain or one it cannot reach with `E_USAGE`; the URL must be http(s), and one with a password needs a username. `TEMPO_RPC_URL` still serves every network and beats a saved `rpc-url`.

  With `TEMPO_RPC_URL` or a saved `rpc-url` in use, a read that a deletion, close, or revocation rests on first checks the endpoint's `eth_chainId` once per command: session reuse, `sessions sync`, `sessions close` (including `--dry-run` and `--finalize`), `revoke`, and `logout --revoke`, including its read of an expired key, refuse an endpoint on another chain with `E_USAGE` and a `cta` of `tempo wallet config get rpc-url`, leaving every stored session and key in place. `whoami`, `keys list`, and `balance` count a balance, a key's on-chain state, or an unlisted token's metadata only on the network's chain, and report it as unknown otherwise, never another chain's value.

  Since these settings decide what later payments and RPC calls use, `config set` and `config unset` need confirmation, as `transfer` does: in a terminal they show the setting's value before and after, and for `rpc-url` its network and the chain it answered, and ask; agent, MCP, or piped runs change nothing without `--yes`, failing with `E_USAGE` and a `cta` that adds it. An `rpc-url` whose path, query, or user info can carry a credential appears in that `cta` as `<rpc-url>`, to be replaced with the full URL. Setting `rpc-url` also warns that the endpoint will receive all of the CLI's RPC traffic on that network. Saving the value already saved, or removing a setting that is not saved, needs no confirmation. A change, with or without `--yes`, applies only while the setting, or for `rpc-url` its network's entry, still holds the value the command read: if another process changed it meanwhile, nothing changes and the command fails with a retryable `E_USAGE`. A change to one network's `rpc-url` leaves the other network's as the file holds it. Over MCP, `config_get` is read-only, and `config_set` and `config_unset` are destructive and idempotent.

- Spending-limit and MACH settlement errors now carry a `cta` with the command that fixes them. A charge the access key's spending limit refuses, `tempo wallet swap --yes` above the key's limit (previously `E_USAGE`, exit 2), and an explicit MACH payment whose key cannot spend the MACH return `E_LIMIT_EXCEEDED` (exit 4) with `tempo wallet keys update <key> --token <token> --limit <amount> --network <network>` for the token the payment debits and the amount it needs, in that token's decimals; a refusal by the fee token's limit, or for a token whose decimals cannot be read, stays `E_PAYMENT` without a `cta`. The MACH-unavailable error is split by cause: a MACH balance below the charge returns `E_INSUFFICIENT_FUNDS` with `tempo wallet fund --mach --address <payer> --network mainnet` as its `cta` (no `cta` on testnet), stored call scopes that leave out the MACH token or swapper return `E_PAYMENT` naming the call, a swap route that cannot be simulated returns `E_PAYMENT` without a `cta` (retryable when the failure looks transient), and an unreadable MACH balance returns retryable `E_NETWORK`. MCP tool errors carry the same `cta`.
- Add `tempo wallet fund status`, which resumes waiting on a funding after the default handoff, a timed-out `--wait`, or Ctrl-C (`--interval`, `--max-attempts`). `fund` now prints and returns the funding URL before any RPC read, then saves the pending funding with each delivered token's starting balance to `~/.tempo/wallet/pending-fund.json` (mode 0600; a `logout` of its network cancels the logged-in wallet's funding) and returns a `_next` naming `fund status`. A funding completes only when the token its flow delivers rises by the requested amount: MACH by the full `--amount` (or the $5 checkout minimum), and stablecoins by 95% of it to allow for card onramp fees (or $1 without one, so dust transfers do not count), watching OUSD and USDC.e for general and crypto funding, USDC.e for referral claims, and pathUSD on testnet. A timed-out or cancelled wait returns retryable `E_POLL_TIMEOUT` naming the URL with a `cta` to `fund status`. Funding URLs now use `TEMPO_AUTH_URL` like the rest of the CLI, and every `fund` result names the watched token's `symbol`.
- `tempo wallet` prints a human-readable view when stdout is a terminal and no output format is asked for. Objects print as aligned `Label  value` blocks and lists as tables (or blocks when a table would not fit the terminal width), with labels taken from the output keys, amounts shown with their token symbol, token addresses shortened to `0x20c0…8b50`, raw base-unit amounts left out when a formatted amount shows them, and `_next` and `cta` commands as `Next:` lines. Errors print on stderr as `Error: <message>` with any `Next:` fix, keeping their exit codes. Labels are dimmed, successes green, and failures red, only on a terminal and as `NO_COLOR` and `FORCE_COLOR` say. Piped output, `--format`, `--json`, `-j`, `-t`, `--json-output`, `--toon-output` (unless `=false`), `--full-output`, `--filter-output`, `--schema`, `--llms`, and MCP output are unchanged.
- `tempo wallet transfer` token transfers and `tempo wallet swap` accept `--idempotency-key <key>`, so a retried send cannot go out twice. Each key is recorded for the logged-in wallet on the resolved network in `~/.tempo/wallet/idempotency/` (mode 0600) before the transaction is sent, and pruned after 30 days. Rerunning a key that sent the same request sends nothing and returns the recorded result with `idempotent_replay: true` and `status` read from the chain; a key used for a different request fails with `E_USAGE` naming the arguments that differ; and a key whose send never recorded an outcome fails with `E_PAYMENT_OUTCOME_UNKNOWN` instead of sending again. Replays and unknown outcomes need no usable access key, even in agent runs. Dry runs record nothing and carry the key into `_next`. `E_PAYMENT_OUTCOME_UNKNOWN` from `transfer` and `swap` is now returned with a `cta`: with a known transaction hash, the message names it and the `cta` is `tempo wallet tx status <hash> --network <network>`; otherwise the `cta` is `tempo wallet whoami`. The new `tempo wallet tx status <hash>` (MCP `tx_status`, read-only) reports a transaction's `status` (`success`, `reverted`, `pending`, or `not_found`), `block_number`, `from`, `to`, and `fee`, each RPC read bounded to five seconds, with a `_next` that polls a pending transaction.
- Move `tempo wallet revoke` to `tempo wallet keys revoke`, next to `keys list` and `keys update`, with the same arguments, confirmation, and output. Its `_next` and `cta` commands now name `tempo wallet keys revoke`, and MCP serves it as `keys_revoke`.

  `tempo wallet revoke` and the MCP `revoke` tool are deprecated aliases that run the same command; they will be removed in a future release. Run from a terminal, `revoke` prints a notice on stderr; agent runs, including MCP and `--format`, get no notice and the same output as `keys revoke`.

- `tempo wallet logout --network <network>` (or `TEMPO_WALLET_NETWORK`) logs out of that network only: it removes the network's access keys and a pending login for it, keeps the wallet while it still has its own keys on another network, and moves the wallet's network there. Without a network, logout still logs out of every network and now reports `scope: "all"`.

  `--revoke` revokes each removed key on-chain through the wallet app before removing it, on the network the wallet is logged in on; a logout that also covers keys on another network is refused with `E_USAGE` naming the network logout to run first. A key the chain does not show revoked is kept with the wallet, and the command fails naming it. A key expired by the local clock is checked on-chain: it is removed without asking the wallet app unless the chain still shows it published, in which case it is revoked like the rest. Without `--revoke`, the output notes that removed keys stay authorized on-chain until they expire.

  Logout now lists stored sessions on the networks it logs out of (on every network when it removes the wallet) that still hold unspent deposits, with an `instruction` and `_next` naming the `tempo wallet sessions close --all` (or `--finalize`) that withdraws them after logging in again. Such a logout, and any `--revoke`, needs confirmation: a `[y/N]` prompt in a terminal, or `--yes`, which until now did nothing. A session store that exists but cannot be read, because sqlite3 is not installed or the database is corrupt, needs the same confirmation, so `--yes` still logs out. An agent run, or one whose stdin is not a terminal, without `--yes` fails with `E_USAGE` and a `cta` that adds it. `--no-browser` is accepted for `--revoke`.

  Over MCP, the `logout` tool now sets `openWorldHint`, since `--revoke` reaches the wallet app and the chain.

  **Output change:** logout's `logged_in` field, which meant "was logged in", is renamed `was_logged_in`. The output also adds `scope`, `keys`, and `sessions`.

- **Breaking:** MCP tools take positional arguments under kebab-case keys, like every option. Renamed keys, old -> new:

  - `keys_update` and `revoke`: `accessKey` -> `access-key`.
  - `swap`: `tokenIn` -> `token-in`, `tokenOut` -> `token-out`.
  - `sessions_close`: `url` -> `target`, which also takes an origin or channel ID.

  The old keys are no longer accepted. The new `keys_revoke`, `tx_status`, and `services_show` tools take `access-key`, `tx-hash`, and `service-id`; the deprecated `services` tool keeps `serviceId` until it is removed. The CLI takes these arguments by position as before; `--help` and the README show the new names, and `--describe` names `sessions close`'s argument `target`.

- **Breaking:** output keys and values follow one naming and format style. Renamed keys and changed values, old -> new:

  - `login`, `login status`, and `refresh`: `chainId` -> `chain_id`, with `network` added beside it; `accounts` are lowercase.
  - `sessions close --dry-run`: `targets[].state` -> `targets[].status`, with the lowercase values `sessions list` reports (`Active` -> `active`, `Closing` -> `closing`, `Finalizable` -> `finalizable`, `Orphaned` -> `orphaned`, `not found` -> `not_found`); the result adds `status: "dry_run"`.
  - `transfer --mach` and `transfer --credits`: `dry_run: true` -> `status: "dry_run"`; a sent payment adds `status: "success"`.
  - Service details (`services <id>`, now `services show <id>`, and the MCP `services` tool): `docs.llmsTxt` -> `docs.llms_txt`, `docs.apiReference` -> `docs.api_reference`, `endpoints[].payment.unitType` -> `endpoints[].payment.unit_type`, and `endpoints[].payment.amount` (base units) -> `endpoints[].payment.raw_amount`; `price` keeps the amount in whole tokens.
  - `sessions list` and `sessions close`: `remaining_secs` -> `remaining_seconds`.
  - Access keys in `whoami` `key`, `keys list`, and `revoke --dry-run` `key`: `wallet_address` -> `wallet`.
  - `tempo request --dry-run`: `amount_raw` -> `raw_amount`, `deposit_raw` -> `raw_deposit`; `token` and `signer.address` are lowercase, and `network` is added beside `chain_id`. `transfer --mach`: `amount_raw` -> `raw_amount`.
  - Token amounts use minimal decimals (`"10"`, not `"10.000000"`): sessions `deposit`, `spent`, and `remaining`; `whoami` `balance.total`, `locked`, and `pending_refund`; and key `spending_limits[].limit` and `spending_limit.limit` (`"0"` for a key that cannot spend).
  - `tempo request` receipts and `--output` metadata: `payer` and `signer.address` are lowercase.

  Output schemas now type session `status` (`active`, `closing`, `finalizable`, `finalized`, `orphaned`), key `status` (`ready`, `pending`, `expired`, `unusable`), the `sessions close --dry-run` targets, and the `services show` docs and endpoints, and describe the HTTP `status` of a `tempo request --dry-run` probe that needed no payment.

- **Breaking:** Make `tempo wallet fund` a browser handoff only. Remove `fund --wait`, `--timeout`, `fund status`, the `fund_status` MCP tool, and `_next` funding continuations. Balance polling, thresholds, pending funding storage, and the funding polling environment settings are removed. This supersedes the earlier funding-status entry. `--amount` remains an editable checkout prefill.

  **Migration:** Use `fund` to open the wallet, or `fund --no-browser` to return its URL, then confirm the destination wallet's intended token balance before spending. Do not replace `fund --wait && <paid command>` with `fund && <paid command>`: exit code zero and `status: "pending"` confirm only the handoff, not a deposit. Removed CLI polling commands fail with `E_USAGE` (exit 2); `--no-wait` and `--wait=false` remain harmless compatibility options. MCP clients should refresh their tool list and stop calling `fund_status` or following a funding `_next`; calls to the removed tool fail, and `fund` rejects `wait: true` or any `timeout` argument.

- `tempo request` no longer starts a browser login when a 402 needs payment and no wallet is logged in. Without a logged-in wallet, or a `--private-key`/`TEMPO_PRIVATE_KEY` signer, it exits 4 with `E_NOT_AUTHENTICATED` and a `cta` naming `tempo wallet login --network <network>`. An expired access key now returns `E_KEY_EXPIRED` instead of `E_AUTH_REFRESH_REQUIRED`, and a missing or unusable one `E_AUTH_REFRESH_REQUIRED` (including a stored key the signer rejects, which previously failed with `E_PAYMENT`), each with a `cta` naming `tempo wallet refresh --network <network>`; previously these errors carried no `cta`. A `--dry-run` quote for a wallet that cannot pay keeps reporting the challenge and adds `instruction` and `_next` with the same command. Responses other than 402 still need no login.
- **Breaking:** legacy `transfer` and `fund` flags are retired. Each fails with `E_USAGE` naming what replaces it before the command parses its options or runs, so nothing is sent, and its `cta` is the equivalent command when the run's arguments give one, it is the only retired flag given, and a `send` would not carry an option only `transfer` takes. `--value` is removed from `transfer`, since transfers carry no ETH value; for a zero value the `cta` is the same run without it. `transfer --mach --amount-cents <cents>` is removed, whatever its value; for whole cents the `cta` passes the same cap in USD with `--max-spend`, and with `--max-spend` also given, whose cap would conflict, there is no `cta`. `fund --claim <code>` is removed; the `cta` passes the code with `--referral-code`, or, when `--referral-code` is also given, which took precedence, the same run without `--claim`. A token transfer, `send` or `transfer` without `--credits` or `--mach`, now refuses `--to`, `--data`, and `--amount-cents` instead of ignoring them, and the `cta` for `--to` passes the recipient as the third argument of `send`.

  `transfer --credits` keeps `--to`, `--data`, and `--amount-cents`, which are still the only way to spend legacy MPP Credits. The MCP `transfer` and `fund` tools keep `value` and `claim` in their input schemas for one release, described as removed and refused with the same message, even when `false`. `transfer` refuses `amount-cents` with `mach`, and `data` or `amount-cents` on a token transfer, so no client has an argument silently dropped.

- Add `tempo wallet send <amount> <token> <to>` and the MCP tool `send`, which send a token transfer with the arguments, options (`--fee-token`, `--dry-run`, `--yes`, `--idempotency-key`, `--address`), output, confirmation, and logged-in network check of `transfer`. Token transfer dry runs now point `_next` at `tempo wallet send`, and a missing argument names its usage.

  The token form of `tempo wallet transfer` and of the MCP `transfer` tool is a deprecated alias that runs the same command; it will be removed in a future release. Run from a terminal, a token `transfer` prints a notice on stderr; agent runs, including MCP and `--format`, get no notice and the same output as `send`. `transfer --mach` and `transfer --credits` are unchanged and stay on `transfer`, which is now described as paying an MPP challenge with `--mach` or `--credits`. `send --mach` or `send --credits` fails with `E_USAGE` and a `cta` naming the same command under `transfer`, sending nothing; an explicit false, such as `--mach=false` or `--no-credits`, selects no mode and sends tokens as usual. An `--idempotency-key` used with `transfer` replays under `send`, and the reverse.

- Add `tempo wallet services list`, `services search <query>`, and `services show <id>`, and the MCP tools `services_list`, `services_search`, and `services_show`. `search` keeps the word matching of `--search`, reading unquoted words as one query, and `show` the endpoint prices and not-found suggestions of `services <id>`; bare `services` still lists. The old forms are deprecated but keep working with the same output: `services <id>` runs `services show <id>`, and `services --search <query>` and `services list --search <query>` run `services search <query>`. Each prints a deprecation notice on stderr only when stdout is a terminal and no `--format` is set, so agent and JSON output is unchanged. A subcommand name now wins over a service id: `services search` and `services show` are the subcommands, and a service whose id is `list`, `search`, or `show` is looked up with `services show <id>`. The `services` MCP tool keeps taking `serviceId` and `search` for one release, and its description now marks it deprecated. A search over 256 characters or 16 words now reports `Search queries accept at most ...` instead of naming `--search`.
- **Breaking:** `tempo wallet sessions close` now requires explicit confirmation before it requests a close, closes cooperatively, or withdraws, like `transfer` and `revoke`. Scripts and agents that close without `--yes` must add it: a run without `--yes` whose stdin or stdout is not a terminal (including MCP and `--format`) sends nothing and exits 2 with `E_USAGE` and a `cta` that reruns the same command (its target, `--all`, `--orphaned`, `--finalize`, `--cooperative`, and `--network`) with `--yes`. With a terminal on both, a run without `--yes` lists each session's channel, origin, network, and deposit and asks `[y/N]`; declining sends nothing and exits 2 with `E_USAGE`. A close that selects no channel, such as an origin without a session or `--finalize` with nothing past its grace period, neither asks nor needs `--yes`. `--dry-run` never asks, and now returns `instruction` and a `_next` that is the same command with `--yes`. The commands a pending or cooperative close names in `_next` and `instruction`, which complete a close already confirmed, now include `--yes`. `sessions sync` is unchanged: it sends no transaction and only removes local records of channels the chain shows closed or does not hold.
- `tempo wallet whoami` and `tempo wallet keys list` now read the logged-in wallet's access keys from the AccountKeychain precompile, each on the key's own network, with a 3-second timeout and no retries. With `TEMPO_RPC_URL` set, which serves every network, a network's reads count only once the endpoint's `eth_chainId` matches it, asked once per network. Each key reports `published`: whether the chain holds it unrevoked, or `null` when it was not read, as for another stored wallet's keys, a failed read, or a `TEMPO_RPC_URL` on another chain. For a published key whose limits the chain enforces, `spending_limits[]` now report the chain's `remaining` limit instead of always `null`; an unpublished key, which the chain would read as zero remaining, keeps it `null`. `spent` stays `null`, since the chain exposes only the remaining limit and not the limit it counts down from. A `pending` key is signed but not yet published on chain and still pays, since its first payment publishes it; one the chain already holds is now reported `ready`. `whoami`'s `ready` follows the reported key status, so the two never disagree.

  The singular `spending_limit` on `whoami` and `keys list` keys is deprecated and will be removed in a future release; use `spending_limits`. Until then it repeats `spending_limits[0]` with the key's spending `mode`, including for legacy keys whose limit it previously reported as `null`. `whoami --mach` now reports its token address, and `whoami --credits` its wallet, in lowercase like the rest of the output.

### Patch Changes

- Update `accounts` to 0.21.0. Revocations now name the key's network, so `tempo wallet logout --revoke` revokes keys on every network it logs out of, including networks the wallet is not logged in on, instead of failing with `E_USAGE` and asking for a logout per network.

  `tempo wallet revoke` no longer undoes a login another process makes while it waits for confirmation or the wallet app. `tempo wallet logout` stops with a retryable `E_USAGE`, writing nothing, when such a login or refresh changes the wallets, network, or keys it logs out of.

- `tempo wallet --describe` is generated from the commands and their option schemas, so it lists what the parser accepts, with the help `--help` shows. It now lists the options of bare `sessions` (`--orphaned`, `--all`) and bare `services` (`--refresh`), and describes `--verbose` as the boolean flag it is rather than an option taking a value. The help of `--network`, `login --wait`, `login status`, `fund`, `fund status`, `keys update`, `swap`, and `transfer` arguments and options is now their `--help` or MCP text. `--help` for `whoami` and `keys list` notes that `spending_limit` is deprecated, and `send` and `transfer` describe the default `--fee-token`.
- Session payments in `tempo request`, and `--idempotency-key` sends in `tempo wallet transfer` and `tempo wallet swap`, no longer let two waiting processes into their lock at once after its holder was killed. The lock is now an OS file lock held by a `sqlite3` child, which the system releases when its holder exits, so no stale lock is ever taken over. An `EEXIST` error inside a locked step no longer runs the step again. Without `sqlite3` on `PATH`, a session payment still fails with `E_PAYMENT` (so `--payment-intent auto` still offers a one-time charge), now saying to install it, with `tempo wallet doctor` as its `cta`. An `--idempotency-key` send without `sqlite3` falls back to a pid-file lock that is never taken over. Its holder removes it on release or when Ctrl-C, `SIGTERM`, or a hangup ends the process. One left behind otherwise, as by `SIGKILL`, fails with `E_RUNTIME` (not retryable) naming the file and that process, and saying to remove the file once no `tempo` process is running. Session locks are kept as one empty file per origin in `~/.tempo/wallet/session-locks/`. The `sqlite3` processes the CLI runs, for locks and for the session store, no longer read the user's `~/.sqliterc`, whose settings could make a busy lock look taken or change the query output the CLI parses.
- `SKILL.md` lists every MCP tool with its `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`, generated from the commands. It adds `debug` and `completions` as read-only, and `fund`, `fund_status`, and `sessions_list`, which are neither read-only nor destructive. The README command list, also generated, adds `revoke`, `keys list`, `keys update`, `mcp add`, `skills add`, and `skills list`, and gives each command's description and options.
- `tempo wallet sessions list` and `sessions close` now show the sessions that earlier releases (the Rust CLI) stored in `~/.tempo/channels.db`, `~/.tempo/sessions.db`, or `~/.tempo/wallet/sessions.db`, so their deposits can be withdrawn. The next session payment or `tempo wallet sessions` command copies them into `~/.tempo/wallet/channels.db`, once per file; the files are left as they are. Sessions an older CLI creates in one of those files afterwards are not copied, and that CLI keeps managing them. When `channels.db` already holds the same channel, a requested close is kept, no deposit or cumulative amount is lowered, and the rest comes from the record used more recently, except that a channel `sessions list --orphaned` found takes its origin and URL from the old record. A close that presto recorded is shown as closing until its grace period ends. A file that cannot be read is reported on stderr and retried by a later command.
- Include MACH in wallet balances using the same fallback as the default currency, including zero. Request dry runs show MACH balances separately from the advertised currency, keeping balance labels and access-key limits consistent.
- `--help` and `--describe` say that `--max-spend` caps a MACH payment in MACH (1 MACH = 1 USD) for `tempo request`, `config set max-spend`, and `transfer --mach`, and that `send` and `transfer` `--address` is a guard that must match the paying wallet, except with `transfer --credits`, where it names the wallet whose credits to spend.
- Package tempo-wallet and tempo-request with Node.js 22.23.4 by pinning pkg-fetch to 3.6.7, including the October security fixes in both standalone binaries.
- A `tempo wallet login` that ends while another login starts no longer deletes the newer login's pending code, which left `tempo wallet login status` reporting the newer login cancelled. A `tempo wallet logout` that cannot cancel the pending login it logs out now fails with a retryable error naming the same command, before revoking a key or changing the wallet store, instead of letting that login finish after the logout.
- A login saving its pending login no longer fails with `ENOENT` when another login clears it at the same moment.
- Transactions the wallet provider fills, signs, and sends with the local access key (`tempo wallet transfer`, `swap`, and `sessions close`) now use `TEMPO_RPC_URL`, or the CLI's default RPC for the network, like every other RPC call the CLI makes. They previously went to viem's built-in chain RPC and ignored `TEMPO_RPC_URL`.
- Fixed payment intent negotiation before the initial request. Explicit charge and session intents now send `Accept-Payment`, and MACH requests prefer charges automatically, so session-default services can offer MACH-enabled charges without a manual header. Explicit `Accept-Payment` headers remain unchanged.
- `tempo wallet revoke` keeps the local access key when the wallet app returns but the chain does not show the key revoked, as its `E_NETWORK` error already said. The wallet SDK drops the key from the store as soon as the wallet app returns, so the key is now restored from the store as it was before the revocation.
- `SKILL.md` names the canonical commands and MCP tools: `tempo wallet send` and `send` for token transfers, keeping `transfer` for `--mach` and `--credits` payments; `tempo wallet keys revoke` and `keys_revoke` instead of the deprecated `revoke`; and `services search <query>`, `services show <id>`, and `services list` instead of `services --search` and `services <id>`. It adds `tempo wallet balance` and `tempo wallet address`, a Settings section on `tempo wallet config` (each key's precedence, the confirmation `config set` and `config unset` need, and the `rpc-url` chain check), and the saved `network` and `max-spend` in the network and spending-cap rules. Its list of MCP tools that refuse to act without `yes: true` now matches the CLI: `send` (and a token `transfer`), `swap`, `keys_revoke`, `sessions_close`, `config_set`, `config_unset`, and `logout` when it needs confirmation.
- `SKILL.md` points agents at `https://tempo.xyz/skills/wallet/SKILL.md` for the exact setup commands, instead of the `tempo.xyz/SKILL.md` router.
- Importing sessions from legacy session databases no longer reads the user's `~/.sqliterc`, whose `.bail off` could let a failed import commit part of its changes.
- `tempo wallet transfer` token transfers on a network other than the one the wallet is logged in on now send nothing and exit 2 with `E_USAGE` and a `cta` naming `tempo wallet login --network <network>`, with or without an access key there, before any lookup or prompt, as `swap` does. The wallet app, which approves a transfer whenever no access key can sign it, approves only on the logged-in chain. An agent run without a key on that network gets this login `cta` rather than a refresh one. A transfer also checks the logged-in chain again when it sends, and sends nothing, exiting 2 with `E_USAGE`, if another login switched it meanwhile, for example while the confirmation prompt was open. `--dry-run` still reviews the transfer, and `transfer --mach` and `transfer --credits` are unchanged.
- `sqlite3` failures now report `E_RUNTIME` (exit 1) with the same message, instead of `UNKNOWN`. This covers `sqlite3` failing to start or failing to take a lock, used by session payments, `config`, login, and `--idempotency-key` sends. It also covers a session store query that fails or cannot start `sqlite3`, used by `sessions` and session payments. A missing `sqlite3` is reported as before. A `sqlite3` that cannot start for a transient reason (`EAGAIN`, `EMFILE`, `ENFILE`, `ENOMEM`) is retryable, as is a session store another process held past the busy timeout. `EMFILE` and `ENFILE` no longer crash the CLI with an uncaught error. Under `tempo request --payment-intent session`, or `auto` when no one-time charge fits, a session store failure reports `E_RUNTIME` (exit 1) instead of `E_PAYMENT` (exit 4). `--payment-intent auto` still offers a fitting one-time charge for a failure that is not retryable. It now reports a retryable one as is, so the session can be retried instead of paying a non-refundable charge. `--dry-run` still reports a session as `null` when the store cannot be read.
- Use viem's chain-specific token constants for built-in currency addresses.

## 0.14.0 (2026-10-15)

### Minor Changes

- `tempo wallet --mcp` now declares MCP tool annotations on every tool, so a client can tell reads from spends. `whoami`, `keys_list`, `services`, `doctor`, `debug`, and `completions` set `readOnlyHint`. `transfer`, `swap`, `sessions_close`, `sessions_sync`, `keys_update`, `revoke`, `logout`, `login`, `login_status`, and `refresh` set `destructiveHint`. `fund` and `sessions_list` change state without either. `idempotentHint` marks the tools that are safe to repeat, and `openWorldHint` every tool except `completions` and `logout`, which make no network requests.
- `tempo request` now reports what a successful paid request spent. A short receipt goes to stderr, such as `Paid 0.01 USDC.e · tx 0x…`, and `--write-meta` adds it as a `payment` object: `intent`; `amount` in token units with `token`, plus `symbol` and `decimals` for a listed token (MACH for a MACH settlement); `tx_hash` when the server's Payment-Receipt names a transaction; `session` (`open` or `reuse`), `channel_id`, `deposit_locked` and `cumulative` for a session payment, including a top-up, or `null` for a charge; for a subscription, `subscription` with its billing `period` and `expires`, reported on stderr as a recurring authorization, plus the first period's payment when the receipt names its transaction; `payer`; and `chain_id` and `network`. A newly opened session also names `tempo wallet sessions close <channel_id> --network <network>` on stderr and as `instruction` and `_next`, so its locked deposit is not forgotten. Structured output (`-j`, `--format`) keeps stderr empty, so its receipt is read from `--write-meta`. The summary follows the delivered body. When a paid response's body then fails to arrive, the command exits with `E_PAYMENT_OUTCOME_UNKNOWN` and `--write-meta` keeps the receipt for recovery, marked `outcome: "unknown"`. Unpaid requests, zero-amount proofs, paid requests answered with an HTTP error or an unfollowed redirect, and sessions whose server receipt cannot be stored report no receipt, and the response body on stdout is unchanged.
- **Breaking:** `tempo wallet transfer` token transfers now require explicit confirmation, like `swap`. Scripts and agents that send without `--yes` must add it: a run without `--yes` whose stdin or stdout is not a terminal (including MCP and `--format`) sends nothing and exits 2 with `E_USAGE` "Transfer not sent: review it with --dry-run, then pass --yes". With a terminal on both, a run without `--yes` shows the amount, token, recipient, network, and fee token and asks `Send this transfer? [y/N]`; declining sends nothing and exits 2 with `E_USAGE`, and a confirmed transfer pays its fee in the token shown. `--dry-run` now reports `fee_token`, `fee_estimate` in fee-token units, the wallet's `balance` and `fee_token_balance`, and `sufficient_balance` (the amount against `balance` and the fee against `fee_token_balance`; `false` on any known shortfall), each lookup bounded to three seconds and `null` when unknown, and its `_next` pins the reviewed fee token with `--fee-token` and includes `--yes`. **Also breaking:** `--address` must now match the logged-in wallet, in dry runs too. Transfers are now sent on the resolved network instead of the chain the wallet was last logged in on. `transfer --mach` and `transfer --credits` are unchanged. `tempo wallet revoke` likewise prompts only when stdin is a terminal too; with piped stdin it needs `--yes`, as an agent run does.
- Add `tempo wallet doctor`, which reports the setup on the resolved network: CLI, Node, incur, and accounts SDK versions; the stored wallet and its type; the access key's status, expiry, and spending limits; whether the RPC answers `eth_chainId` on the expected chain, and how fast; the wallet app URL; sqlite3; the session store; and which environment overrides are set. Each finding is an `ok`, `warn`, or `fail` check, and `_next` names the `tempo wallet login` or `tempo wallet refresh` that fixes the most important problem. Checks run concurrently with their own deadlines, an unhealthy setup still exits 0, and secrets never appear: `TEMPO_PRIVATE_KEY` is reported only as set, and URL credentials, paths, and queries are redacted.

  `tempo wallet debug` is deprecated: it prints a notice on stderr and returns the `doctor` report, replacing its previous output, which reported every wallet as a passkey and versions as `(local)`.

### Patch Changes

- Commands that read or write stored payment sessions now wait up to 5 seconds for another CLI process's lock on `channels.db` instead of failing at once with "database is locked". Parallel `tempo request` calls, or `tempo wallet sessions` during a paid request, could fail this way, most often while the first run created or migrated the database, and `tempo wallet whoami` could report no session funds.
- `tempo wallet fund` toon output no longer shows `symbol: null` for flows other than `--mach`. The field is now omitted, as JSON output already omitted it, so both formats report the same keys.
- `tempo wallet login`, `tempo wallet login status`, and `tempo wallet refresh` with `--network` switch the wallet's stored network only once the wallet app approves. Previously the network was saved as soon as the request started, so a login or refresh on another network that was denied, expired, timed out, was left pending, or was interrupted still moved every later command without `--network` to that network.
- Set `TEMPO_NO_BROWSER` to stop `tempo wallet` from opening a browser for login, key, revoke, and fund approvals; the URL and code are still printed.
- Wallet commands wait for the wallet store to load before using the wallet provider. On a slow machine, `transfer`, `swap`, `sessions close`, `keys update`, `revoke`, and paid requests could fail with "No accounts connected." or `Account "0x…" not found.`, `tempo request` could start a new login for a logged-in wallet, and `tempo wallet login` could drop the access keys already stored.

  A wallet store that cannot be read, or has not loaded within 10 seconds, fails the command with `E_RUNTIME` instead of running it on an empty store. `transfer`, `swap`, and `sessions close` now send from the wallet they checked, and refuse with `E_NOT_AUTHENTICATED` when another login has replaced that wallet in the meantime, instead of sending from the other wallet.

- `tempo wallet sessions list --all` and `--orphaned`, and `sessions close --all` and `--orphaned`, no longer overwrite a stored session when they find its channel on-chain. A session stored while the scan ran, or one stored for the origin `http://127.0.0.1`, which the listing skips, was replaced by an orphaned record without its origin, request URL, or signer.
- `SKILL.md` has agents quote paid requests with `--dry-run` and wait for explicit approval, then pin the paid request to the approved amount and the quote's network, payment intent, and token. It also documents the default network and declares the skill's `MIT OR Apache-2.0` license.
- `tempo wallet swap` is now sent only on the chain the wallet is logged in on, with that chain set explicitly on the transaction. Previously a swap quoted and reviewed with `--network` on another network was submitted on the logged-in chain. Such a swap is now refused before quoting, with or without an access key for that network, since the wallet app that approves a swap no key can sign works on the logged-in chain: it sends nothing and exits 2 with `E_USAGE` and a `cta` naming `tempo wallet login` with that `--network`. Its dry run still quotes.

## 0.13.0 (2026-10-14)

### Minor Changes

- `tempo wallet revoke` now sends the revocation through the wallet app, so it works after a device-code login, where the CLI holds no signer for the wallet itself. It revokes a key stored for the logged-in wallet on the selected network, or one created elsewhere that the chain shows authorized for that wallet, and fails with `E_USAGE` listing the wallet's stored keys otherwise. A stored key not yet published on-chain is authorized and revoked in one transaction, and the command reports success only once the chain shows the key revoked; otherwise it keeps the local key and returns `E_NETWORK`. Because revocation cannot be undone, an interactive run asks to confirm and an agent run needs `--yes`; without it, it returns `E_USAGE` with a `cta` that adds `--yes`. `--dry-run` shows the key, wallet, network, limits, and expiry, and its `_next` adds `--yes`.

  `tempo wallet refresh` and `revoke` accept `--no-browser`, like `login` and `keys update`, to print the wallet-app URL and confirmation code instead of opening a browser.

  A wallet-app request that fails or whose device code expires is no longer resent up to three more times, so each approval shows one confirmation code. This covers `revoke` and wallet-app approvals for transfers, swaps, session closes, and payments.

- Select the network the same way for every `tempo wallet` and `tempo request` command: `--network`/`-n`, then `TEMPO_WALLET_NETWORK`, then the logged-in wallet's network, then mainnet. After `tempo wallet login -n testnet`, commands such as `whoami`, `transfer`, `swap`, `sessions`, `debug` and `tempo request` now stay on testnet instead of falling back to mainnet. `--network` is a CLI-wide option that may appear before or after the command or in a stack of short flags such as `-sn testnet`; option values that look like it (`-d -n`, `--data --network=testnet`) stay with their option. MCP tools still accept a `network` argument. `keys update` and `revoke` reject a network that differs from the logged-in wallet's.

  JSON output for `whoami`, `whoami --mach`, `debug`, `transfer`, `swap`, `revoke`, `keys update`, `fund` and `sessions list` now includes `chain_id` and `network`. `keys list` labels each key from its own chain and wallet, queries balances only for the logged-in wallet's keys, and filters by `--network` or `TEMPO_WALLET_NETWORK` when either is set. When `--private-key` or `TEMPO_PRIVATE_KEY` pays, the logged-in wallet's network does not apply. `_next` continuations always end with `--network` set to the network the command resolved.

- Return `instruction` and `_next` (`argv`, a POSIX-quoted `command`, and optional `until` and `poll_interval_seconds`) on multi-step `tempo wallet` results: `swap`, `transfer`, and `revoke` dry runs point at the submitting command, a pending `sessions close` points at the withdrawal after the grace period, and `keys update` and a fresh `login` point at the command that confirms the result. The continuation repeats the selected `--network`.

  `tempo wallet swap` accepts `--min-amount-out` (exact input) and `--max-amount-in` (`--exact-out`): the submitted bound is the stricter of the slippage bound and the reviewed one, a fresh quote that cannot meet it is refused with `E_LIMIT_EXCEEDED`, and the dry-run continuation pins the reviewed bound.

- Run `tempo wallet fund`, bare `tempo wallet sessions`, `login --no-browser`, and `help` through the regular command parser. `--format` now applies to their output (TOON by default, like other commands), `fund` errors use the standard error output, `fund --llms` prints the manifest instead of starting a funding flow, and `tempo wallet help <command>` shows that command's help. `tempo wallet completions` now hooks the `tempo` launcher so bash and zsh completions work for `tempo wallet`, and the PowerShell and Elvish scripts register for `tempo` and list every command, including `swap`, and the global flags. The bash, zsh, and Elvish hooks pass other `tempo` subcommands to a previously registered completer.
- Cap `tempo request` spending at 10 payment token units (about $10 in stablecoins) when neither `--max-spend` nor `TEMPO_MAX_SPEND` is set. The cap bounds each charge, each session deposit, a reused session's cumulative vouchers, and session top-ups. A session deposit suggested above the cap is lowered to the cap, since opening needs only a deposit that covers the per-call amount. A payment over the cap, under the default or an explicit cap, is now refused with `E_LIMIT_EXCEEDED` (exit 4) before it is signed, instead of `E_PAYMENT`, and its `cta` reruns the same command with the needed `--max-spend` and the resolved `--network`, showing `--private-key`, `--bearer`, `--user`, proxy credentials and credential headers such as `Authorization` and `Cookie` as `<redacted>`. Under `--payment-intent auto`, a reused session refused by the cap also suggests a one-time charge within the cap when the server offers one. A top-up whose resulting on-chain deposit exceeds the cap is refused with `E_LIMIT_EXCEEDED` instead of surfacing the server's 402; since that request's voucher was already sent, it points at `tempo wallet sessions list` rather than suggesting a rerun. Recurring subscriptions are not subject to the default cap. `--dry-run` previews, including `tempo wallet transfer --mach --dry-run`, check offers against the same default.
- `--dry-run` on a 402 now reports what the payment would spend: `session` (`open` or `reuse`) and the `deposit` a session payment would lock, chosen by the same code the payment runs, including the top-up a reused session's voucher needs beyond its on-chain deposit; the token's `decimals`, and its `symbol` only when viem lists the token; the payer's `balance` and the access key's stored `access_key_limit` for the debited token, in that token's decimals, with `0` when the key's exact stored limits leave the token out; `max_spend`, the cap the payment applies (`--max-spend`, `TEMPO_MAX_SPEND`, or the default 10); and `within_budget`, computed against that cap instead of always `true` when a cap is set. A subscription offer has no cap, so both are `null`, and `within_budget` is also `null` when a session's payer or reuse check is unknown. Balance, token and session reads use a 3-second timeout and report `null` when they fail. The dry run still signs nothing, opens no session, and leaves stored sessions in place.
- `--dry-run` on a URL that does not answer 402 now prints `{ payment_required: false, status, probe_sent: true }` instead of the response body, and never writes the body to stdout or `-o`. Methods other than GET, HEAD, and OPTIONS add a `warning` that the request was sent and may have had side effects. `--dry-run` help now says the request is sent to discover the payment challenge.
- Refuse to pay a 402 challenge when `--insecure`/`-k` disables TLS certificate verification, unless `--allow-insecure-payment` is passed. `--dry-run` quotes remain allowed. Describe `--insecure` accurately in help and `--describe` output.
- `tempo wallet transfer` (token and `--mach` payments), `swap`, `keys update`, `revoke`, and `sessions close`, dry runs included, now check for a logged-in wallet on the selected network before doing anything else. `transfer --mach`, and `transfer` and `swap` run by an agent (MCP, `--format`, or output that is not a terminal), also check for a usable access key. A missing login returns `E_NOT_AUTHENTICATED`, an expired key `E_KEY_EXPIRED`, and a missing or unusable key `E_AUTH_REFRESH_REQUIRED` (exit 4), each with a `cta` naming `tempo wallet login --network <network>` or `tempo wallet refresh --network <network>`, which MCP tool errors also include. These commands previously reported `E_USAGE` "Configuration missing" or an error without a command; agent runs also started a login (`--mach`) or a wallet app approval (expired key) instead of failing, and `swap --dry-run` returned a quote without a usable key. Interactive `transfer` and `swap` runs without a usable key ask for approval in the wallet app, and `keys update`, `revoke`, and `sessions close` need only the login, not a usable key. `keys update` without an access key argument now updates the only key stored for the wallet and network, whatever its status, and returns `E_USAGE` listing the keys when there are several. `transfer --credits` and `transfer --mach` paid by `TEMPO_PRIVATE_KEY` still run without one.
- Split `tempo wallet login` across processes. An agent run (MCP, `--format`, or output that is not a terminal) now returns at once with `status: "pending"`, `verification_url`, `user_code`, `expires_at`, and a `_next` naming the new `tempo wallet login status`, which waits for the wallet's approval (`--interval`, `--max-attempts`) and finishes the login. A terminal run still waits; `--wait` and `--no-wait` override either default. The pending login is saved with mode 0600 next to the wallet store, replaced by a new `login`, and cancelled by `logout`; a `login status` whose code was replaced or cancelled meanwhile stops with `E_USAGE` and discards a late approval.

  Login now waits until the device code expires instead of stopping after five minutes, and reports its outcomes with typed errors instead of `UNKNOWN`: `E_LOGIN_DENIED` and `E_LOGIN_EXPIRED` name `tempo wallet login`, while `E_POLL_TIMEOUT` and `E_NETWORK` (also for HTTP failures from the wallet) are retryable and name the same `login status` (#149).

- Make `tempo wallet services` discovery easier to use: cache the service directory for 10 minutes and fall back to the cached copy (marked `stale` with `fetched_at`) when the fetch fails, add `--refresh` to bypass the cache, match every word of `--search` independently across id, name, description, tags, and categories, add a formatted `price` to each endpoint payment, and suggest close ids when a service is not found (now `E_NOT_FOUND`).
- Accept token symbols listed by viem for the selected network (case-insensitive, e.g. `USDC.e`, `usdc`, `pathUSD`, `MACH`) wherever a token is taken: `tempo wallet swap`, `tempo wallet transfer`, `--fee-token`, `tempo wallet keys update --token`, and `tempo request --payment-token`. Unknown symbols fail with `E_USAGE` and list the network's symbols; `tempo request` rejects a `--payment-token` symbol that no network lists before sending the request. Token addresses are accepted in any case, and `_next` continuations carry the resolved address. `keys update --limit` is read in the token's own decimals and rejects extra precision, so a swap whose input token is not 6-decimal now also points a limited key at `keys update`. `whoami` and `keys` show symbols from the same listing (now `pathUSD`, `OUSD`, `MACH`) and spending limits in each token's decimals, with the stored base units in a new `raw_limit` field. Unlisted tokens are read on chain once per token, and only for the active wallet's keys; when a token's symbol or decimals are unknown, `symbol` and `limit` are `null` rather than an address or a guessed scale. An unlisted token's on-chain or asset-list symbol is shown only when it is a plain ticker (up to 16 letters, digits, `.`, `_`, or `-`); otherwise its `symbol` is `null`, including in `swap` and `transfer` output, and instructions and errors name it by its address. `sessions` reports listed symbols or `null`. When asset discovery omits the payment token, `whoami` marks the balance it reads directly as `verified` only if the token is listed.
- Report typed error codes instead of `UNKNOWN` (exit 1) for invalid `--json` input (`E_USAGE`), missing logins (`E_NOT_AUTHENTICATED`, also on `tempo request` payment paths), funding and session-lock waits (`E_POLL_TIMEOUT`), missing session data (`E_NOT_FOUND`), and submitted transactions whose receipt lacks a hash (`E_PAYMENT_OUTCOME_UNKNOWN`). Transport failures and request timeouts on GET, HEAD, and OPTIONS requests now report `E_NETWORK` with `retryable: true`; other methods stay non-retryable and note that the request may have reached the server. `tempo wallet fund --json-output` errors now include `retryable`.

### Patch Changes

- Update incur to 0.7.1 and disable its automatic npm update checks.
- Allow direct legacy MPP Credit transfers through MCP while continuing to reject token-transfer arguments with credits.
- Return the funding handoff immediately by default. Use `--wait` to watch for a positive balance increase; `--amount` supplies the checkout amount without requiring an equivalent deposit. Scripts that depended on the old blocking behavior must add `--wait`.
- `tempo wallet keys update` on an access key not yet published on chain, such as one from a recent login, now keeps the replacement key authorization the wallet app returns. It previously overwrote the wallet store with the copy it loaded before the update, so the key's first payment could publish the old limit while `keys list` showed the new one.
- Explain that MACH cannot be swapped instead of returning a DEX error.
- Fix `tempo wallet --mcp` failing to start in release binaries.
- Validate `--private-key` and `TEMPO_PRIVATE_KEY` without echoing the key, report which key pays instead of the logged-in wallet on stderr, in `--dry-run` output, and in `--write-meta` metadata, and warn that `--private-key` can leak through shell history.
- Restore spending existing MPP Credits with `transfer --credits` and viewing their balance with `whoami --credits`, with deprecation warnings. Reject `fund --credits` and direct users to `fund --mach` to buy MACH.

  Honor `TEMPO_MAX_SPEND` for legacy credit payments, require a cap for challenge spending, and reject conflicting positional or direct-transfer arguments.

  Bound credit challenge input before parsing with mppx, reject malformed or expired challenges and unsupported splits or pull-only payments, show payment details in dry runs, and validate credit permits and fee-inclusive spending caps before signing. Recheck challenge expiry before redemption, time out stalled credit-service requests, and report uncertain redemptions without retrying. Escape terminal controls and bound server error details.

- Strip terminal escape sequences and invisible Unicode from server-supplied text in service listings, payment errors, and cooperative session close errors, and show server-supplied identifiers such as challenge IDs with visible escapes. Service directory entries whose id is not a plain slug are skipped, and duplicate ids are reported instead of resolved to the first match.
- Fetch the service directory from its public URL without a deployment-protection bypass parameter, time out after 10 seconds, and report failures as `E_HTTP` or `E_NETWORK` errors.
- `tempo wallet sessions close` no longer removes a local session record unless the session's own chain shows the channel closed: the escrow reports it finalized, or for a v2 session the channel precompile logged its `ChannelClosed` event. A channel ID or URL whose sessions are on another network is refused with `E_USAGE` before any on-chain call, naming that network and the command to rerun with its `--network`, and a channel the escrow does not hold is reported as `not_found` (counted as failed) with its record kept instead of as `closed`. The exception is a v2 session whose close was already requested: the channel precompile clears a closed channel, so its cleared state removes the record and reports `closed` even when the `ChannelClosed` event is past the log scan.

  A close sends `requestClose` and `withdraw` only on the session's own chain: the transaction names that chain, a session on a chain other than the one the wallet is logged in on is reported as an error naming the `tempo wallet login --network` command to run first (a wrong-network refusal names that login before the rerun too), and a reverted receipt is reported as an error with the record left as it was instead of marking the close requested or removing the record.

  A `--cooperative` close the server accepted but the chain does not show yet is reported as `requested` (counted as pending) and keeps its record, including a v2 session's descriptor, marked `closing` so a later payment to the service opens a new channel instead of reusing this one; its `_next` reruns a plain `sessions close`, which removes the record once the close is on-chain.

  `sessions close --finalize <target>` withdraws only the target's channels instead of every finalizable channel on the network, and `--finalize` never requests a close: a target whose close was not requested is reported as an error, and one still in its grace period as pending. A pending close's `instruction` names the `--cooperative` command that closes it now through its server for v1 sessions, and the command help describes close as a request followed by a withdrawal after the grace period.

- Reject `tempo wallet swap` amounts with more fractional digits than the token's decimals with `E_USAGE` instead of silently rounding them, in both exact-input and `--exact-out` modes and under `--dry-run`.
- Validate `tempo wallet transfer` arguments before loading the wallet: missing arguments, malformed token or recipient addresses, the zero-address recipient, and non-positive or over-precise amounts now fail with `E_USAGE`, including under `--dry-run`.

## 0.12.1 (2026-10-12)

### Patch Changes

- Honor the requested wallet network during login, access-key refresh, and identity checks, including when the persisted wallet previously selected another chain. Allow login retries after failed authorization by reusing cached sessions only when a usable key exists for the requested account and network.

  Select MPP payment offers on the requested network before choosing a payment intent. Include the selected network in access-key refresh instructions for failed requests.

## 0.12.0 (2026-10-10)

### Minor Changes

- Replace legacy MPP Credits entry points with onchain MACH funding, balance queries, and capped MPP payments. Add remote checkout handoffs, bounded funding waits, explicit MACH selection with no stablecoin fallback, and recovery for uncertain payment outcomes. Deprecated `--credits` aliases now select MACH with a warning; existing offchain credits are not converted or redeemed.

### Patch Changes

- Preserve omitted and empty access-key permissions through storage. Report permission modes explicitly and show unknown for legacy metadata, with nullable limit fields where appropriate.
- Update `accounts` to 0.19.0.
- Update `mppx` to 0.12.0 and `viem` to 2.57.1.
- Restore general wallet funding as the default for `tempo wallet fund`. Keep MACH checkout explicit with `--mach` or the deprecated `--credits` alias.
- Release session locks left without a usable pid by a holder that died before recording it, instead of timing out every later request to that origin.
- Report a malformed `request` parameter in `tempo wallet transfer --credits --mpp-challenge` as a usage error instead of an uncaught JSON parse failure.
- Update dependency security fixes and strengthen dependency installation policy.
- Strip credential-bearing headers when `tempo request` follows a cross-origin redirect.
- Allow `tempo wallet swap` to submit with an access key that has no spending limits instead of asking for a `keys update` that would restrict it.
- Honor `TEMPO_MAX_SPEND` when `tempo request --max-spend` is not set.
- Update the bundling and packaging tools used to build the wallet and request CLI binaries, and refresh development dependencies.
- Query `whoami` balances, asset discovery, and session reserves concurrently, and bound status RPC and asset lookups to three seconds so a stalled upstream no longer blocks for ~40 seconds.

## 0.11.0 (2026-09-09)

### Minor Changes

- Add an access-key-aware `tempo wallet swap` command with quoting, slippage bounds, dry-run review, and explicit submission confirmation.
- Report every held Tempo token and its active access-key limit from `tempo wallet whoami` while preserving the existing payment balance output.

### Patch Changes

- Preserve binary response bytes in default stdout and file output without requiring `--stream`.
- Exit nonzero when any session close fails, while preserving the structured summary and successful pending-close exit status.
- Handled missing browser opener errors on headless systems without terminating the CLI.
- Preserve final payment responses and HTTP error output, and report uncertain payment outcomes with safe recovery references.
- Enforce payment caps and network selection before credential creation, validate request options, and preview decoded payment quotes without paying.
- Show closing and finalizable session reserves as `balance.pending_refund` in `whoami` and include them in `balance.total` until withdrawal completes.
- Stream SSE JSON incrementally, respect retry deadlines, preserve repeated multipart fields, and route HEAD output consistently.
- Report unavailable wallet balances as unknown instead of zero and include RPC diagnostics in wallet readiness output.

## 0.10.4 (2026-09-01)

### Patch Changes

- Remove the unsupported MACH funding option and its configuration dependency.

## 0.10.3 (2026-09-01)

### Patch Changes

- Verify and reuse identical versioned R2 objects while rejecting version collisions.

## 0.10.2 (2026-08-31)

### Patch Changes

- Stage release assets in a draft before publishing immutable GitHub releases.

## 0.10.1 (2026-08-31)

### Patch Changes

- Added exact payment-token selection and actionable delegated-key limit diagnostics.
- Route the default MACH configuration lookup through Mercator's production onramp API.

## 0.10.0 (2026-08-27)

### Minor Changes

- Add a MACH funding flow that opens the Wallet onramp and waits for the mainnet token balance to increase.

## 0.9.0 (2026-08-26)

### Minor Changes

- Updated authentication to the new device-code flow.

## 0.8.0 (2026-08-25)

### Minor Changes

- Add `tempo request --payment-intent auto|session|charge` with explicit consent for direct-charge
  fallback after session recovery fails.

### Patch Changes

- Await the whoami payload in the compatibility `login --no-browser` path so it prints wallet details instead of an empty object.
- Fall back to compatible charge challenges when servers also offer legacy Tempo sessions.
- Report stale access keys before payment construction and direct users to refresh them.
- Reject Tempo session challenges and automatic top-ups that target noncanonical escrow contracts.
- Update production dependencies while preserving direct MCP tool discovery.

## 0.7.0 (2026-08-01)

### Minor Changes

- Added access key limit updates and moved key listing from `keys` to `keys list`.

  ```diff
  -tempo wallet keys
  +tempo wallet keys list
  +tempo wallet keys update [access-key] --limit <amount>
  ```

## 0.6.7 (2026-07-15)

### Patch Changes

- Support P-256 access keys for V2 MPP session vouchers.

## 0.6.6 (2026-07-14)

### Patch Changes

- Use stored P-256 access keys when creating MPP payment credentials.
- Fix typed sessionOutput schema to allow nullable created_at and last_used_at fields.
- Wrap `tempo wallet services` list results in a `services` object for MCP tool calls.
- Use the network-appropriate TIP-20 token for wallet balances, funding, sessions, and transfers, including six-decimal PathUSD support on Moderato testnet.

## 0.6.5 (2026-07-01)

### Patch Changes

- Use accounts SDK managed access keys for request payments and report their local key status correctly.
- Harden supply chain configuration, dependency updates, and release workflows.

## 0.6.4 (2026-06-24)

### Patch Changes

- Read CLI version output from package metadata instead of a hardcoded source fallback.

## 0.6.3 (2026-06-24)

### Patch Changes

- Fix `tempo request --no-proxy` so it disables proxy use instead of being parsed as an invalid negation of `--proxy`.

## 0.6.2 (2026-06-23)

### Patch Changes

- Show all stored access key limits, periods, scopes, and local key status in wallet key output.
- Automatically dispatch the build and publish workflow after creating a release tag, so release assets and extension manifests publish without manual intervention.
- Migrate legacy `keys.toml` wallet state into the new `store.json` format on first run.
- Fix `tempo wallet login --no-browser` and `tempo wallet fund --no-browser` option parsing.
- Update production dependencies and pin transitive WebSocket dependencies to patched advisory ranges.
- Harden wallet store writes so local key material is saved under private file and directory permissions.
- Keep local CLI version output aligned with the package version.
- Add a wallet command to revoke access keys and remove revoked local key state.
- Align generated wallet command metadata for service discovery and integration schema requests.

## 0.6.1 (2026-06-19)

### Patch Changes

- Add changelog enforcement, generation, release PR automation, and automatic tag creation for future wallet-cli releases.
- Make release PR updates detect existing `changelog-release/main` pull requests reliably before attempting to create a new one.
- Allow changelog-generated commits and release PR updates to use a configured `GH_PAT`, so automation-created branches can trigger normal CI when the token is available.
- Fix `tempo request` handling for services that return both Tempo `WWW-Authenticate` challenges and x402 `payment-required` descriptors, and extend refreshed wallet access keys to 30 days.

## 0.6.0 (2026-06-18)

### Minor Changes

- Add packaged `tempo request` support alongside `tempo wallet`, update both CLIs for current SDKs, and publish signed extension manifests through the Tempo launcher update path.

### Patch Changes

- Harden v2 session flows for descriptor persistence/reuse, top-up, close/finalize, key authorization rehydration, and live wallet balance/session reporting.
