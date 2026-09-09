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
tempo wallet swap 10 <TOKEN_IN> <TOKEN_OUT> --dry-run

# Submit the reviewed swap
tempo wallet swap 10 <TOKEN_IN> <TOKEN_OUT> --yes

# Fund your wallet
tempo wallet fund

# Discover available paid services
tempo wallet services --search ai
```

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
budget assessment, without opening the wallet or paying. `--max-spend` rejects an offer
above the cap in both preview and execution; invalid amounts fail before the HTTP request.
For reusable sessions, execution also checks cumulative spending against the cap.
Capped recurring subscriptions are rejected because a per-period authorization cannot enforce
a cumulative cap.

`--network` overrides `TEMPO_WALLET_NETWORK`; the default is mainnet. `tempo`/`mainnet`
and `tempo-moderato`/`moderato`/`testnet` are aliases. Unknown networks and payment
challenges for a different chain are rejected before payment.

When a server offers both reusable sessions and one-time charges, choose an intent explicitly:

```sh
tempo request --payment-intent session https://example.mpp.tempo.xyz/v1/resource
tempo request --payment-intent charge https://example.mpp.tempo.xyz/v1/resource
```

`--payment-intent auto` is the default. It prefers a reusable session and permits one session
extension attempt. If that fails and a compatible charge is available, the CLI reports its exact
amount and requires an explicit retry with `--payment-intent charge`; it never silently purchases
non-refundable charge capacity.

When a service offers the same payment in multiple tokens, select the exact token address:

```sh
tempo request --payment-intent charge --payment-token 0x20c000000000000000000000b9537d11c60e8b50 https://example.mpp.tempo.xyz/v1/resource
```

Session-based services open a reusable payment channel:

```sh
tempo request -X POST \
  --json '{"input":"hello"}' \
  https://service.mpp.tempo.xyz/v1/stream

tempo wallet sessions list
tempo wallet sessions close https://service.mpp.tempo.xyz
```

`tempo wallet sessions close` preserves its per-session result summary and exits with status 1 if any close failed. A pending close awaiting the grace period is successful initiation, so pending-only results still exit 0; dry runs also exit 0.

## Commands

`tempo wallet` includes:

- `login`, `logout`, `refresh`, `whoami`, `keys`
- `fund`
- `transfer`
- `swap`
- `services`
- `sessions list`, `sessions close`, `sessions sync`
- `debug`
- `completions`

Credit-related flows use `whoami --credits`, `fund --credits`, and `transfer --credits`.

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

The release workflow builds standalone Linux and macOS binaries for both `tempo-wallet` and `tempo-request`. Each binary is published with a checksum, SBOM, Sigstore bundle, and GitHub attestations.

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
