# Changelog

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
