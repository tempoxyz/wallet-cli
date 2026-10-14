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

# Check wallet status
tempo wallet whoami

# Quote a swap without submitting it
tempo wallet swap 10 USDC.e pathUSD --dry-run

# Submit the reviewed swap, refusing less output than the reviewed min_amount_out
tempo wallet swap 10 USDC.e pathUSD --min-amount-out <MIN_AMOUNT_OUT> --yes

# Fund your wallet
tempo wallet fund

# Discover available paid services
tempo wallet services --search ai
```

Token arguments (`swap`, `transfer`, `--fee-token`, `keys update --token`, and `tempo request --payment-token`) take a full 0x address or a symbol that viem lists for the selected network, matched case-insensitively; a bridged token also answers to its symbol without `.e` (`USDC` is `USDC.e`). An unknown symbol fails with `E_USAGE` and lists the network's symbols. Output and `_next` continuations always carry the resolved address.

`tempo wallet whoami` separates available funds, active-session `locked` reserves, and `pending_refund` reserves in closing or finalizable sessions. `total` includes all three; pending refunds remain unavailable until withdrawal completes.

If the balance RPC is unavailable, `whoami` reports `ready: false`, `balance.available: null`, `balance.total: null`, and a `balance.error` diagnostic. Wallet and key details remain available, along with locally recorded session reserves. An unavailable key balance is also `null`; key details in `whoami` and `keys` include a `balance_error` diagnostic when the query fails. A successful zero-balance query is reported as zero; `ready` checks wallet/key configuration and balance-query success, not whether a particular purchase is affordable.

Make a paid HTTP request:

```sh
# Preview payment details
tempo request --dry-run https://example.mpp.tempo.xyz/v1/resource

# Pay and retry automatically
tempo request https://example.mpp.tempo.xyz/v1/resource
```

On HTTP 402, `--dry-run` prints a JSON quote with the selected amount, token, chain and
budget assessment, without opening the wallet or paying. Any other status prints
`payment_required: false` with the status instead of the body. The probe request is still
sent, so methods other than GET, HEAD and OPTIONS also report a side-effect `warning`.
`--max-spend` rejects an offer above the cap in both preview and execution; invalid amounts
fail before the HTTP request.
For reusable sessions, execution also checks cumulative spending against the cap.
Capped recurring subscriptions are rejected because a per-period authorization cannot enforce
a cumulative cap.

Every `tempo wallet` and `tempo request` command selects its network the same way:
`--network`/`-n` (anywhere on the command line), then `TEMPO_WALLET_NETWORK`, then the
network of the logged-in wallet, then mainnet. After `tempo wallet login -n testnet`, later
commands stay on testnet without repeating the flag. `tempo`/`mainnet` and
`tempo-moderato`/`moderato`/`testnet` are aliases. Unknown networks and payment challenges for
a different chain are rejected before payment. Network-scoped JSON output reports `chain_id`
and `network`. `tempo wallet keys list` shows keys on every network, each labeled with its own
chain and wallet, unless `--network` or `TEMPO_WALLET_NETWORK` selects one; balances are queried
only for the logged-in wallet's keys, so other stored wallets are never sent to an RPC endpoint.
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

Results with a follow-up step include `instruction` and `_next`. `swap`, `transfer`, and `revoke` dry runs point at the command that submits them, and the swap command pins the reviewed `--min-amount-out` (or `--max-amount-in` with `--exact-out`); a pending `sessions close` points at the withdrawal and sets `poll_interval_seconds` to the remaining grace period; `keys update` and a fresh `login` point at the command that confirms the result. `_next.argv` is authoritative and always ends with `--network` set to the network the command resolved, so it targets the same chain wherever it runs; `_next.command` is the same argv quoted for a POSIX shell.

`transfer` (token and `--mach` payments), `swap`, `keys update`, `revoke`, and `sessions close`, dry runs included, first check for a logged-in wallet on the resolved network; without one they exit 4 with `E_NOT_AUTHENTICATED` and a `cta` naming `tempo wallet login` with that `--network`. `transfer --mach`, and `transfer` and `swap` run by an agent (MCP, `--format`, or output that is not a terminal), also need a usable access key; otherwise they exit 4 with `E_KEY_EXPIRED` or `E_AUTH_REFRESH_REQUIRED` and a `cta` naming `tempo wallet refresh` with that `--network`. An interactive `transfer` or `swap` without one asks for approval in the wallet app instead. `keys update`, `revoke`, and `sessions close` need only the login, not a usable key. Without an access key argument, `keys update` updates the only key stored for the wallet and network, and fails with `E_USAGE` listing the keys when there are several. `transfer --credits` and `transfer --mach` paid by `TEMPO_PRIVATE_KEY` skip the check.

`tempo wallet revoke <ACCESS_KEY>` revokes a key of the logged-in wallet on the resolved network: one stored for the wallet, or one created elsewhere that the chain shows authorized for it. Any other address fails with `E_USAGE` listing the wallet's stored keys on that network. The wallet app signs the revocation, so it needs no local signer for the wallet itself. A stored key not yet published on-chain is authorized and revoked in one transaction. The command succeeds only once the chain shows the key revoked; otherwise it keeps the local key and exits 3 with `E_NETWORK`. Revocation cannot be undone, so an interactive run asks `[y/N]` first and an agent run needs `--yes`; without it, it exits 2 with `E_USAGE` and a `cta` that adds `--yes`. `--dry-run` shows the key, wallet, network, limits, and expiry, and its `_next` adds `--yes`.

`login`, `refresh`, `keys update`, and `revoke` ask the wallet app for approval; `--no-browser` prints the URL and confirmation code instead of opening a browser. `refresh` and `keys update` keep the stored key until the wallet app approves the change, so a declined or failed approval leaves the current key usable. A wallet-app request that fails or whose code expires is not resent, so each approval shows one confirmation code; rerun the command to try again.

## Commands

### Wallet

`tempo wallet` includes:

- `login`, `logout`, `refresh`, `whoami`, `keys`
- `fund`
- `transfer`
- `swap`
- `services`
- `sessions` (same as `sessions list`), `sessions close`, `sessions sync`
- `debug`
- `completions <bash|zsh|fish|nushell|powershell|elvish>`
- `help [command]` (same as `[command] --help`)

Completion scripts hook the `tempo` launcher and complete after `tempo wallet`, for example `eval "$(tempo wallet completions zsh)"` in `~/.zshrc`. The bash, zsh, and Elvish scripts pass other `tempo` subcommands to a completer registered before them. The PowerShell script replaces any existing `tempo` completer, because PowerShell cannot read or chain one.

`tempo wallet fund` opens the wallet's general funding UI, which also offers Buy MACH. By default, the CLI waits for USDC.e on mainnet or pathUSD on testnet. Use `fund --mach` to open MACH checkout and wait for MACH instead; `whoami --mach` reads its on-chain balance. MACH replaces MPP Credits. Existing MPP Credits remain spendable through `transfer --credits`, and `whoami --credits` shows the legacy balance. Both emit a deprecation warning. `fund --credits` fails: new MPP Credits cannot be purchased; use `fund --mach` to buy MACH instead.

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
tempo wallet fund --mach --amount 10 --no-browser --no-wait --format json
tempo wallet whoami --mach
```

The JSON handoff includes `status: "pending"`, the destination wallet, chain, token, amount, and a URL under `https://wallet.tempo.xyz/agent?action=fund&intent=mach`. Open that URL on any device to complete the wallet's available funding flow. `--address` can specify a destination without a local login. Hosted checkout accepts $5–$100 USD with at most two decimal places. MACH funding currently supports mainnet (4217), with token `0x20c000000000000000000000f37de3740adec032` and six decimals.

Omit `--no-wait` to poll the destination's MACH balance. A requested amount is complete only after the balance increases by that full amount. Without an amount, any positive increase completes the wait. The default timeout is 600 seconds; use `--timeout <seconds>` to change it, or Ctrl-C to cancel. A balance delta is observational evidence, not a checkout receipt. Concurrent spending can delay detection. No-wait returns the handoff without requiring RPC access.

Use `tempo request --mach --max-spend 0.05 <url>` to require MACH for a one-time charge. The exact challenge must advertise `machineTokenEnabled: true`; the installed `mppx` SDK settles into the merchant's advertised currency. An explicit MACH selection never silently falls back to stablecoins. `--payment-token MACH` is equivalent. `--dry-run` inspects an offer without spending. MACH is not supported for sessions. Funding MACH does not convert old Coinflow credits.

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
