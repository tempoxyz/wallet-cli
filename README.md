<br>
<br>

<p align="center">
  <a href="https://tempo.xyz">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tempoxyz/tempo/refs/heads/main/.github/assets/tempo-wordmark-white.svg">
      <img alt="Tempo wordmark" src="https://raw.githubusercontent.com/tempoxyz/tempo/refs/heads/main/.github/assets/tempo-wordmark-black.svg" width="360">
    </picture>
  </a>
</p>

<br>
<br>

# Tempo Wallet CLI

**Command-line wallet and HTTP client for the [Tempo](https://tempo.xyz) blockchain, with built-in [Machine Payments Protocol](https://mpp.dev) support.**

**[Website](https://wallet.tempo.xyz)**
| [Docs](https://tempo.xyz/developers/docs/cli)
| [MPP Spec](https://mpp.dev)

## What is Tempo Wallet CLI?

Tempo Wallet CLI combines wallet access, key management, and an HTTP client that pays automatically in one tool. It is for developers who need to interact with Tempo or MPP-enabled services from the command line or scripts without building payment-handling logic themselves. `tempo wallet` manages wallet access, keys, balances, transfers, and payment sessions. `tempo request` supports familiar curl-style requests and handles `402 Payment Required` challenges automatically through the [Machine Payments Protocol (MPP)](https://mpp.dev).

## When to use Wallet CLI

Use Wallet CLI when you want a ready-made wallet and command-line workflow for interactive use or scripts. Use [mpp-rs](https://github.com/tempoxyz/mpp-rs), [mpp-go](https://github.com/tempoxyz/mpp-go), or [pympp](https://github.com/tempoxyz/pympp) when you are adding MPP payment handling directly to an application instead of using a standalone CLI.

## Install

Install the Tempo launcher:

```sh
curl -fsSL https://tempo.xyz/install | bash
```

The launcher manages `tempo wallet` and `tempo request` extensions automatically.

## Quick Start

```sh
# Log in with your passkey
tempo wallet login

# Remote-host login when your browser is on another device
tempo wallet login --no-browser

# Agent login in two steps: get the code and URL, then wait for approval
tempo wallet login --no-browser --format json
tempo wallet login status --interval 5 --format json

# Check wallet status
tempo wallet whoami

# Quote a swap without submitting it
tempo wallet swap 10 USDC.e pathUSD --dry-run

# Submit the reviewed swap, refusing less output than the reviewed min_amount_out
tempo wallet swap 10 USDC.e pathUSD --min-amount-out <MIN_AMOUNT_OUT> --yes

# Review a transfer's fee estimate and balance, then send it
tempo wallet transfer 5 USDC.e <RECIPIENT> --dry-run
tempo wallet transfer 5 USDC.e <RECIPIENT> --yes

# Fund your wallet
tempo wallet fund

# Discover available paid services
tempo wallet services --search ai
```

`tempo wallet login` uses the wallet app's device code. In a terminal it prints the code and URL to stderr and waits for approval until the code expires. An agent run (MCP, `--format`, or output that is not a terminal) returns at once with `status: "pending"`, `verification_url`, `user_code`, `expires_at`, and a `_next` naming `tempo wallet login status`; `--wait` and `--no-wait` choose either behavior. The pending login, including the access key it asks the wallet to authorize, is kept in `~/.tempo/wallet/pending-login.json` (mode 0600) so `login status` can finish it from another process, and a new `login` replaces it. `login status` checks every `--interval` seconds (default: the wallet's interval) until the wallet approves, then stores the account and key and returns what a blocking `login` returns. A denied or expired code fails with `E_LOGIN_DENIED` or `E_LOGIN_EXPIRED` (exit 4) and a `cta` naming `tempo wallet login`; `--max-attempts` checks that all come back pending fail with retryable `E_POLL_TIMEOUT`, and an unreachable or failing wallet (a transport error or an HTTP status other than 200 or 400) with retryable `E_NETWORK`, each with the same `login status` as its `cta` and the login kept. Without a pending login, `login status` fails with `E_USAGE` naming `tempo wallet login`. `tempo wallet logout` cancels a pending login for the networks it logs out of, and a `login status` already waiting when a new `login` or `logout` replaces its code stops with `E_USAGE` and discards any late approval, leaving the newer login in place.

Token arguments (`swap`, `transfer`, `--fee-token`, `keys update --token`, and `tempo request --payment-token`) take a full 0x address or a symbol that viem lists for the selected network, matched case-insensitively; a bridged token also answers to its symbol without `.e` (`USDC` is `USDC.e`). An unknown symbol fails with `E_USAGE` and lists the network's symbols. Output and `_next` continuations always carry the resolved address.

`tempo wallet transfer` sends a token transfer only once it is confirmed. When both stdin and stdout are a terminal, it shows the amount, token, recipient, network, and fee token, then asks `Send this transfer? [y/N]` on stderr; any answer other than `y` or `yes`, including end of input, sends nothing and exits 2 with `E_USAGE`. Every other run (MCP, `--format`, or stdin or stdout that is not a terminal) must pass `--yes`; without it, it exits 2 with `E_USAGE` and sends nothing. `--yes` also skips the prompt. `--dry-run` reports `fee_token` (`--fee-token`, else the account's default fee token, else the transferred token), `fee_estimate` in fee-token units, the wallet's token `balance` and `fee_token_balance`, and `sufficient_balance`: `true` when `balance` covers the amount and `fee_token_balance` covers the fee (both, when the transferred token pays the fee), `false` on any known shortfall, and otherwise `null` when the fee, the fee token, or a needed balance is unknown. Each RPC lookup is bounded to three seconds, and a failed one is `null`. The dry run's `_next` pins the reviewed `fee_token` with `--fee-token`, and a confirmed prompt pins the fee token it showed, failing with `E_NETWORK` when the account's default cannot be read. `--address` must match the logged-in wallet. `transfer --mach` and `transfer --credits` do not prompt or need `--yes`.

`tempo wallet whoami` separates available funds, active-session `locked` reserves, and `pending_refund` reserves in closing or finalizable sessions. `total` includes all three; pending refunds remain unavailable until withdrawal completes.

If the balance RPC is unavailable, `whoami` reports `ready: false`, `balance.available: null`, `balance.total: null`, and a `balance.error` diagnostic. Wallet and key details remain available, along with locally recorded session reserves. An unavailable key balance is also `null`; key details in `whoami` and `keys` include a `balance_error` diagnostic when the query fails. A successful zero-balance query is reported as zero; `ready` checks wallet/key configuration and balance-query success, not whether a particular purchase is affordable.

`ready` is `true` when a wallet is logged in, its access key on the network can pay (`key.status` `ready` or `pending`), and the balance query succeeded. A `pending` key is signed but not yet published on chain; its first payment publishes it, so it can pay. `whoami` and `keys list` read the logged-in wallet's keys from the AccountKeychain precompile, each on its own network, with a 3-second timeout and no retries. `TEMPO_RPC_URL` serves every network, so with it set each network's reads are trusted only once the endpoint's `eth_chainId` matches, asked once per network. `published` is whether the chain holds the key unrevoked, `null` when it was not read (another stored wallet's key, a failed read, or a `TEMPO_RPC_URL` on another chain), and a pending key the chain already holds is reported `ready`. For a published key whose limits the chain enforces, each `spending_limits[]` entry reports the chain's `remaining` limit. It is `null` for a key that is not published, which the chain would read as zero remaining, when a read fails, or when the token's decimals are unknown. `spent` stays `null`: the chain exposes only what remains, not the limit it counts down from, which another wallet client can change. `key.spending_limit` is deprecated and will be removed in a future release: it repeats `spending_limits[0]` with the key's spending `mode`. Wallet, key, token, and scope addresses in `whoami` and `keys` output are lowercase.

Make a paid HTTP request:

```sh
# Preview payment details
tempo request --dry-run https://example.mpp.tempo.xyz/v1/resource

# Pay and retry automatically
tempo request https://example.mpp.tempo.xyz/v1/resource
```

Once a paid request succeeds, it prints a short receipt on stderr (`Paid 0.01 USDC.e · tx 0x…`)
and `--write-meta` adds it as `payment`: the `intent`; the `amount` in token units and its
`token`, with `symbol` and `decimals` when viem lists the token (a MACH settlement reports the
MACH it debits); `tx_hash` when the server's Payment-Receipt names a transaction; for a session,
`session` (`open` or `reuse`), `channel_id`, `deposit_locked` and the channel's `cumulative`
voucher, `null` for a charge; for a subscription, `subscription` with its billing `period` and
`expires`, since it authorizes `amount` every period instead of paying it once (stderr says
`Authorized a subscription of up to …`, or, when the receipt's `tx_hash` shows activation paid
the first period, `Paid … for the first period` as well); the `payer`; and `chain_id` and
`network`. A newly opened session
also names `tempo wallet sessions close <channel_id> --network <network>`, on stderr and as
`instruction` and `_next`: it requests the close, and rerunning it after the grace period
withdraws the unspent deposit. Structured output
(`-j`, `--format`) keeps stderr free of the summary, so pass `--write-meta` to get the receipt.
The summary follows the delivered body. When a paid response's body then fails to arrive, the
command exits with `E_PAYMENT_OUTCOME_UNKNOWN` and `--write-meta` keeps the receipt for recovery,
marked `outcome: "unknown"`; a delivered receipt has no `outcome`. Unpaid requests,
zero-amount proofs, paid requests answered with an HTTP error or an unfollowed redirect, and sessions whose server receipt
cannot be stored report no receipt.

On HTTP 402, `--dry-run` prints a JSON quote of what paying would spend, without signing,
opening a session, or paying. It reports the per-call `amount`; for a session offer, whether the
payment would `open` a session or `reuse` a stored one (`session`) and the `deposit` it would
lock, decided as the payment decides them (for a reused session, the top-up its voucher needs
beyond the on-chain deposit, usually `0`); the offered `token` with its `decimals`, and its
`symbol` only when viem lists the token, since the server chooses it; the payer's `balance` and
the access key's stored `access_key_limit` for the token the payment debits (MACH with
`--mach`), in that token's decimals, with a limit of `0` when the key's exact stored limits
leave the token out; `max_spend`, the spending cap the payment applies (`--max-spend`,
`TEMPO_MAX_SPEND`, or the default `10`); and `within_budget`, whether the amount, or a reused
session's cumulative spend and top-up, fits that cap. A subscription offer has no cap, so both
are `null`; `within_budget` is also `null` for a session whose payer or reuse check is unknown.
Balance, token and session reads time out after 3 seconds, and a read that fails, or a payer
that is not configured, reports `null`. Any other status prints
`payment_required: false` with the status instead of the body. The probe request is still
sent, so methods other than GET, HEAD and OPTIONS also report a side-effect `warning`.
`--max-spend <amount>` (or `TEMPO_MAX_SPEND`) caps spending in payment token units; without
either, the cap is 10 (about $10 in stablecoins). An offer above the cap is refused with
`E_LIMIT_EXCEEDED` in both preview and execution, before anything is signed, and the error's
`cta` reruns the same command with the `--max-spend` it needs. That command shows
credentials (`--private-key`, `--bearer`, `--user`, proxy credentials, and headers such as
`Authorization` or `Cookie`) as `<redacted>`. When a reused session is refused under
`--payment-intent auto` and the server also offers a one-time charge within the cap, the
`cta` suggests that charge as well. A session deposit suggested
above the cap is lowered to the cap. For reusable sessions, execution also checks cumulative
spending and top-ups against the cap. A top-up is refused after the request's voucher was sent,
so instead of a rerun it points at `tempo wallet sessions list`. Invalid amounts fail before
the HTTP request. The cap
cannot be disabled; pass a larger `--max-spend` instead.
Capped recurring subscriptions are rejected because a per-period authorization cannot enforce
a cumulative cap, so the default cap does not apply to them: `--payment-intent auto` can still
accept a subscription offer. Set `--max-spend`, or pass `--payment-intent charge` or `session`,
to refuse subscriptions.

`tempo request` never starts a login or key refresh. Responses other than 402 need no login.
A 402 without a logged-in wallet exits 4 with `E_NOT_AUTHENTICATED` and a `cta` naming
`tempo wallet login` with the payment `--network`; an expired, missing or unusable access key
exits 4 with `E_KEY_EXPIRED` or `E_AUTH_REFRESH_REQUIRED` and a `cta` naming
`tempo wallet refresh`. In those cases a `--dry-run` quote reports its payer fields as `null`
and adds `instruction` and `_next` with the same command instead of failing. `--private-key` and `TEMPO_PRIVATE_KEY` pay without a login.

Every `tempo wallet` and `tempo request` command selects its network the same way:
`--network`/`-n` (anywhere on the command line), then `TEMPO_WALLET_NETWORK`, then the
network of the logged-in wallet, then mainnet. After `tempo wallet login -n testnet`, later
commands stay on testnet without repeating the flag. `tempo`/`mainnet` and
`tempo-moderato`/`moderato`/`testnet` are aliases. Unknown networks and payment challenges for
a different chain are rejected before payment. Network-scoped JSON output reports `chain_id`
and `network`. `tempo wallet keys list` shows keys on every network, each labeled with its own
chain and wallet, unless `--network` or `TEMPO_WALLET_NETWORK` selects one; balances and on-chain
key state are queried only for the logged-in wallet's keys, each on the key's own network, so other
stored wallets are never sent to an RPC endpoint.
When `--private-key` or `TEMPO_PRIVATE_KEY` pays, the logged-in wallet's network does not apply:
the network is `--network`, then `TEMPO_WALLET_NETWORK`, then mainnet.

When a server offers both reusable sessions and one-time charges, choose an intent explicitly:

```sh
tempo request --payment-intent session https://example.mpp.tempo.xyz/v1/resource
tempo request --payment-intent charge https://example.mpp.tempo.xyz/v1/resource
```

`--payment-intent auto` is the default. It prefers a reusable session and permits one session
extension attempt. If that fails and a compatible charge is available, the CLI reports its exact
amount and requires an explicit retry with `--payment-intent charge`; it never silently purchases
non-refundable charge capacity.

When a service offers the same payment in multiple tokens, select one by symbol or exact address:

```sh
tempo request --payment-intent charge --payment-token USDC.e https://example.mpp.tempo.xyz/v1/resource
```

Session-based services open a reusable payment channel:

```sh
tempo request -X POST \
  --json '{"input":"hello"}' \
  https://service.mpp.tempo.xyz/v1/stream

tempo wallet sessions list
tempo wallet sessions close https://service.mpp.tempo.xyz
```

`tempo wallet sessions close` requests the close on-chain; the deposit is withdrawn by rerunning it, or with `--finalize`, once the grace period ends, and `--cooperative` closes at once through the session's server. It preserves its per-session result summary and exits with status 1 if any close failed. A pending close awaiting the grace period is successful initiation, so pending-only results still exit 0; dry runs also exit 0. A local record is removed only once the session's chain shows the close. A channel the escrow does not hold is reported as `not_found` (unless it is a v2 session whose close was requested, which the cleared channel shows closed), and a cooperative close the chain does not show yet as `requested`; both keep the record, and a `requested` session is not reused for new payments. A target whose sessions are on another network is refused with `E_USAGE` and the command to rerun with that `--network`, after the `tempo wallet login` for that network when the wallet is logged in on another one. Close transactions are sent only on the chain the wallet is logged in on, and a reverted one keeps the record.

Results with a follow-up step include `instruction` and `_next`. `swap`, `transfer`, and `revoke` dry runs point at the command that submits them, each with `--yes`, and the swap command pins the reviewed `--min-amount-out` (or `--max-amount-in` with `--exact-out`); a pending `sessions close` points at the withdrawal and sets `poll_interval_seconds` to the remaining grace period; a pending agent `login` points at `login status`, and a pending `fund` at `fund status`, with `until: '.status != "pending"'` and `poll_interval_seconds`; `keys update` and a finished `login` or `login status` point at the command that confirms the result; a `logout` that leaves sessions holding deposits points at the `sessions close --all` (or `--finalize`) that withdraws them once the wallet logs in again, and names each network's commands in `instruction` when there are several. `_next.argv` is authoritative and always ends with `--network` set to the network the command resolved, so it targets the same chain wherever it runs; `_next.command` is the same argv quoted for a POSIX shell.

`transfer` (token and `--mach` payments), `swap`, `keys update`, `revoke`, and `sessions close`, dry runs included, first check for a logged-in wallet on the resolved network; without one they exit 4 with `E_NOT_AUTHENTICATED` and a `cta` naming `tempo wallet login` with that `--network`. `transfer --mach`, and `transfer` and `swap` run by an agent (MCP, `--format`, or output that is not a terminal), also need a usable access key; otherwise they exit 4 with `E_KEY_EXPIRED` or `E_AUTH_REFRESH_REQUIRED` and a `cta` naming `tempo wallet refresh` with that `--network`. An interactive `transfer` or `swap` without one asks for approval in the wallet app instead. The wallet app approves only on the chain the wallet is logged in on, and is also the fallback whenever no access key can sign a swap or token transfer, so a `swap` or token `transfer` on a network other than the logged-in one sends nothing and exits 2 with `E_USAGE` and a `cta` naming `tempo wallet login` with that `--network`, with or without a key there, before any lookup or prompt; its dry run still quotes or reviews it. `transfer --mach` signs with the selected network's access key, never the wallet app, and `transfer --credits` signs a permit bound to the selected chain, so neither needs that check. `keys update`, `revoke`, and `sessions close` need only the login, not a usable key. Without an access key argument, `keys update` updates the only key stored for the wallet and network, and fails with `E_USAGE` listing the keys when there are several. `transfer --credits` and `transfer --mach` paid by `TEMPO_PRIVATE_KEY` skip the check.

`tempo wallet revoke <ACCESS_KEY>` revokes a key of the logged-in wallet on the resolved network: one stored for the wallet, or one created elsewhere that the chain shows authorized for it. Any other address fails with `E_USAGE` listing the wallet's stored keys on that network. The wallet app signs the revocation, so it needs no local signer for the wallet itself. A stored key not yet published on-chain is authorized and revoked in one transaction. The command succeeds only once the chain shows the key revoked; otherwise it keeps the local key and exits 3 with `E_NETWORK`. Revocation cannot be undone, so a run with a terminal on both stdin and stdout asks `[y/N]` first, and any other run (including an agent's) needs `--yes`; without it, it exits 2 with `E_USAGE` and a `cta` that adds `--yes`. `--dry-run` shows the key, wallet, network, limits, and expiry, and its `_next` adds `--yes`.

`tempo wallet logout` logs out of every network and reports `scope: "all"`; `--network` (or `TEMPO_WALLET_NETWORK`) logs out of that network only. Accounts are not stored per network, so a network logout removes that network's access keys and keeps the wallet while it has its own keys on another network, moving the wallet's network there (`disconnected: false`); once it has none, the wallet is removed too. `keys` lists the removed keys. Without `--revoke` they are only deleted locally and stay authorized on-chain until they expire. `--revoke` first revokes each key on-chain through the wallet app, as `revoke` does, and only on the network the wallet is logged in on: a logout that also covers keys on another network fails with `E_USAGE` before doing anything, naming the network logout to run first. A key the chain does not show revoked is kept, with the wallet, and the command fails naming it (`E_NETWORK`, exit 3, for a wallet-app or chain failure); keys revoked before it are removed. An expired key can neither sign nor be published, so `--revoke` removes it without asking the wallet app and reports it with `revoked: false`, unless the chain still shows it published (a host clock ahead of the chain's, or a stored expiry of zero, which the chain reads as none), in which case it is revoked like the rest. `sessions` lists stored sessions on the networks logged out (on every network when the logout removes the wallet) that still hold unspent deposits, which stay locked until the wallet logs in again. Such a logout, and any `--revoke`, needs confirmation: an interactive run asks `[y/N]`, and an agent run, or one whose stdin is not a terminal, needs `--yes`; without it, it exits 2 with `E_USAGE` and a `cta` that adds `--yes`. A session store that exists but cannot be read, because sqlite3 is not installed or the database is corrupt, needs the same confirmation, so `--yes` still logs out. Without funded sessions or `--revoke`, logout needs no confirmation. `was_logged_in` (formerly `logged_in`) reports whether a wallet or keys were stored for those networks.

`login`, `refresh`, `keys update`, `revoke`, and `logout --revoke` ask the wallet app for approval; `--no-browser` prints the URL and confirmation code instead of opening a browser. Set `TEMPO_NO_BROWSER=1` to do the same for every command, including `login` and `fund`. `refresh` and `keys update` keep the stored key until the wallet app approves the change, so a declined or failed approval leaves the current key usable. A wallet-app request that fails or whose code expires is not resent, so each approval shows one confirmation code; rerun the command to try again.

## Commands

### Wallet

`tempo wallet` includes:

- `login`, `login status`, `logout`, `refresh`, `whoami`, `keys`
- `fund`, `fund status`
- `transfer`
- `swap`
- `services`
- `sessions` (same as `sessions list`), `sessions close`, `sessions sync`
- `doctor` (`debug` is a deprecated alias)
- `completions <bash|zsh|fish|nushell|powershell|elvish>`
- `help [command]` (same as `[command] --help`)

`tempo wallet --mcp` serves each command as an MCP tool (`keys update` as `keys_update`), with a `network` option in place of `--network`. Every tool declares MCP annotations so a client can tell reads from spends. `whoami`, `keys_list`, `services`, `doctor`, `debug`, and `completions` set `readOnlyHint`. `transfer`, `swap`, `sessions_close`, `sessions_sync`, `keys_update`, `revoke`, `logout`, `login`, `login_status`, and `refresh`, which move funds, change or revoke a key, close a session, delete stored sessions, or replace or delete the stored wallet or its network, set `destructiveHint`. `fund` and `sessions_list` (which stores the channels `all` or `orphaned` discovers on-chain) change state without either. `idempotentHint` marks the tools that are safe to repeat, and `openWorldHint` every tool except `completions`, which makes no network requests. The hints are advisory: over MCP, `swap` and `revoke` still refuse to submit without `yes: true`.

`tempo wallet doctor` reports the setup on the resolved network: the CLI, Node, incur, and accounts SDK versions; the stored wallet's address, chain, and type (`passkey`, `private_key`, or `device_code`, from the key type the store records, else `null`); the access key's status, expiry, and spending limits; the RPC URL and whether it answers `eth_chainId` (asked once without retries, with its chain, whether that matches the network, and the latency); the wallet app URL; whether sqlite3 is on `PATH` and its version; whether the session store exists and is readable; and which environment overrides are set. Each finding is a `checks` entry with status `ok`, `warn`, or `fail`; when a command fixes the most important problem, `instruction` and `_next` name it, such as `tempo wallet login` or `tempo wallet refresh` with the resolved `--network`. An unhealthy setup still exits 0, and only an unknown `--network` fails. The checks run concurrently, and the RPC request and sqlite3 each stop after 3 seconds, so one stalled check does not hold up the report. Secrets are never shown: `TEMPO_PRIVATE_KEY` is reported only as set, and the user info, path, query, and fragment of `TEMPO_RPC_URL` and `TEMPO_AUTH_URL` appear as `<redacted>`. `tempo wallet debug` prints a deprecation notice on stderr and returns the same report.

```sh
tempo wallet doctor
tempo wallet doctor --network testnet --format json
```

Completion scripts hook the `tempo` launcher and complete after `tempo wallet`, for example `eval "$(tempo wallet completions zsh)"` in `~/.zshrc`. The bash, zsh, and Elvish scripts pass other `tempo` subcommands to a completer registered before them. The PowerShell script replaces any existing `tempo` completer, because PowerShell cannot read or chain one.

`tempo wallet fund` opens the wallet's general funding UI, which also offers Buy MACH. The CLI opens the browser and returns immediately by default. Use `fund --mach` to open MACH checkout; `whoami --mach` reads its on-chain balance. MACH replaces MPP Credits. Existing MPP Credits remain spendable through `transfer --credits`, and `whoami --credits` shows the legacy balance. Both emit a deprecation warning. `fund --credits` fails: new MPP Credits cannot be purchased; use `fund --mach` to buy MACH instead.

```sh
tempo wallet whoami --credits
tempo wallet transfer --credits --amount-cents 105 --mpp-challenge-file challenge.txt
# Or a direct legacy credit payment (USD cents):
tempo wallet transfer --credits --amount-cents 100 --to 0x...
```

Legacy credit payments retain whole-cent precision. Spending against a challenge requires a cap via `--amount-cents` or `TEMPO_MAX_SPEND`, including Coinflow's quoted gas fees; `--dry-run` needs no cap. `TEMPO_MAX_SPEND` also caps direct transfers; `--max-spend` is for MACH. Positional transfer arguments are unsupported with `--credits`. Direct `--to`, `--data`, and `--value` options cannot be combined with a challenge. `--credits` and `--mach` cannot be combined.

Use `--dry-run` to inspect the destination and calldata. Credit challenges must be unexpired and support push payments (transaction-hash receipts); split payments are unsupported. Coinflow remains trusted to quote gas fees and execute the transaction because its permit authorizes a credit debit without binding the recipient or calldata.

For funding from another device or an automated host:

```bash
tempo wallet fund --mach --amount 10 --no-browser --format json
tempo wallet whoami --mach
```

The JSON handoff includes `status: "pending"`, the destination wallet, chain, token, amount, a URL under `https://wallet.tempo.xyz/agent?action=fund&intent=mach`, and a `_next` naming `tempo wallet fund status --interval 5` with `until: '.status != "pending"'`. The URL is on the same wallet app as `login` (`TEMPO_AUTH_URL`, default `https://wallet.tempo.xyz`). Open it on any device to complete the wallet's available funding flow. `--address` can specify a destination without a local login. Hosted checkout accepts $5–$100 USD with at most two decimal places. MACH funding currently supports mainnet (4217), with token `0x20c000000000000000000000f37de3740adec032` and six decimals.

`--amount` prefills the USD amount in the funding UI and sets how much a wait expects to arrive; it does not enable waiting. General funding and direct MACH funding treat it as an editable prefill. Once a checkout starts, its amount is bound to that order until it can safely be edited. Without `--amount`, the wallet UI chooses its default. General funding accepts positive amounts with up to six decimal places; direct MACH checkout uses the range and precision above.

`fund` prints the URL before reading any balance, so a failing RPC never hides the link. It then reads the starting balance of each token the flow can deliver, opens the browser only after that read so funds the flow delivers quickly are not counted in it, and saves the pending funding (wallet, network, URL, amount, those balances, and an expiry an hour out, or `--timeout` if longer) to `~/.tempo/wallet/pending-fund.json` (mode 0600); a new `fund` replaces it, even one that cannot be resumed. A funding for the logged-in wallet (not an `--address`) ends at a `logout` of its network or once another wallet logs in; an `--address` funding is kept. When the balance cannot be read, the handoff still returns the URL, with an `instruction` to check the balance instead of a `_next`.

Funding counts as arrived when a token the flow delivers rises from its starting balance by enough, so an unrelated small transfer does not count:

- `--mach` watches MACH, which checkout mints exactly: the full `--amount`, or $5 (the checkout minimum) without one.
- General funding and `--crypto` watch OUSD, which card onramps and bridged deposits settle, and USDC.e, which MoonPay settles. A referral claim watches USDC.e, and testnet funding watches pathUSD. Card onramps take their fees out of the purchase amount, so these count from 95% of `--amount`, as the wallet app's own deposit check does; without `--amount`, they count from $1, so a dust transfer does not.

`tempo wallet fund status` resumes waiting on the pending funding from any process: after the default handoff, a timed-out `--wait`, or Ctrl-C. It checks every `--interval` seconds (default: 2) and, once the funds arrive, returns `status: "success"` with the token that arrived and its balance, and forgets the funding. `--max-attempts` checks that find nothing fail with retryable `E_POLL_TIMEOUT`, and a failed balance read with retryable `E_NETWORK`, each with the same `fund status` as its `cta` and the funding kept. Once the funding expires, `fund status` fails with non-retryable `E_POLL_TIMEOUT` naming `tempo wallet fund` and forgets it. Without a pending funding on the network, it fails with `E_USAGE` naming `tempo wallet fund`.

Add `--wait` to wait in the same command instead, for up to `--timeout` seconds (default: 600; `--timeout` applies only with `--wait`). A timeout or Ctrl-C fails with retryable `E_POLL_TIMEOUT`, whose message includes the URL and whose `cta` is `tempo wallet fund status --interval 5`; Ctrl-C cancels the watch, not the browser checkout. A `--wait` that cannot read the starting balance fails with `E_NETWORK` naming the URL. Without `--wait`, the command returns `status: "pending"` with null balances; exit code zero means the handoff was created, not that funding completed. `--no-wait` remains accepted for compatibility.

A balance delta is observational evidence, not a checkout receipt or proof that a particular amount was purchased. Concurrent spending can delay detection, and buying a token the flow does not watch, such as MACH in the general UI, will not satisfy the wait. Scripts that need to wait before spending must explicitly use `--wait` or `fund status`, or check the intended token's balance.

Use `tempo request --mach --max-spend 0.05 <url>` to require MACH for a one-time charge. The exact challenge must advertise `machineTokenEnabled: true`; the installed `mppx` SDK settles into the merchant's advertised currency. An explicit MACH selection never silently falls back to stablecoins. `--payment-token MACH` is equivalent. `--dry-run` inspects an offer without spending. MACH is not supported for sessions. Funding MACH does not convert old Coinflow credits.

When MACH cannot settle a charge, nothing is signed and the error names the cause: an access key whose stored MACH limit is below the charge returns `E_LIMIT_EXCEEDED`; a MACH balance below it returns `E_INSUFFICIENT_FUNDS` with `tempo wallet fund --mach --address <payer>` as its `cta` on mainnet; an unreadable balance returns retryable `E_NETWORK`; stored call scopes that leave out the MACH token or swapper return `E_PAYMENT` naming the call, since `keys update` cannot change scopes; otherwise the swap route did not simulate (swapper liquidity, call scopes, or a transient RPC error) and it returns `E_PAYMENT` without a `cta`, retryable when the failure looks transient. A charge the access key's spending limit refuses, and a `tempo wallet swap --yes` above it, also return `E_LIMIT_EXCEEDED`; a refusal by the fee token's limit, or for a token whose decimals cannot be read, stays `E_PAYMENT` without a `cta`. Each `E_LIMIT_EXCEEDED` has a `cta` naming `tempo wallet keys update <key> --token <token> --limit <amount>`, which sets the limit of the token the payment debits to the amount it needs.

For a captured challenge, `tempo wallet transfer --mach --max-spend 0.05 --mpp-challenge-file <headers>` settles that exact charge and returns its transaction hash. It does not deliver the credential to the merchant; prefer `tempo request` for the complete request/payment flow. Direct calldata is unsupported with `--mach`.

`tempo request` supports common curl-style flags for methods, headers, bodies, output files, redirects, retries, proxies, and streaming responses.

Response bytes are preserved when writing to stdout or a file, including binary audio and images. Use `-o output.wav` to save a response; add `--stream` to write chunks as they arrive instead of buffering the body. `--sse-json` explicitly converts event-stream text to NDJSON.

## Local State

Wallet state is stored under:

```sh
~/.tempo/wallet/store.json
~/.tempo/wallet/channels.db
```

Tests use isolated temporary `HOME` directories so they do not mutate a developer's real wallet state.

## Development

Requirements:

- Node.js 22
- pnpm 11

```sh
pnpm install
pnpm dev -- --help
node --import tsx src/request-cli.ts --help
```

Useful commands:

```sh
pnpm check
pnpm test
pnpm build
pnpm bundle
pnpm package
```

`pnpm check` runs formatting/lint checks, production TypeScript typecheck, test/helper TypeScript typecheck, and Vitest.

## Release Artifacts

The release workflow builds standalone Linux and macOS binaries for `tempo-wallet` and `tempo-request`. Each binary is published with a checksum, SBOM, Sigstore bundle, and GitHub attestations.

## Security

Please do not report vulnerabilities through public issues. Email `security@tempo.xyz`.

Local wallet files may contain access key material. Do not commit files from `~/.tempo/`, `.env`, or generated release artifacts.

## Contributing

Use conventional commit titles and include a `.changelog/*.md` entry for pull requests:

```markdown
---
wallet-cli: patch
---

Brief description of the change.
```

Supported bump levels are `major`, `minor`, `patch`, and `none`.

Run `pnpm check` before submitting changes.

## Request failures and payment recovery

HTTP errors return `E_HTTP` (exit 3) and preserve the response body through the usual output options, including `-o`. Transport failures return `E_NETWORK`. `--dump-header` and `--write-meta` describe the final response after any payment retry. A final HTTP error after submitting a payment credential does not by itself prove that no payment occurred.

If a credential-bearing request or its response delivery fails, `E_PAYMENT_OUTCOME_UNKNOWN` (exit 4) means payment may have completed. Available challenge, transaction, or session references help the provider investigate; they do not prove settlement. Check with the provider before creating another payment. A transaction hash is only reported when the credential supplies one; signed pull transactions are never printed. The CLI cannot guarantee result recovery or a refund.
