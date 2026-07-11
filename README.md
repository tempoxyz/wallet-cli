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

# Fund your wallet
tempo wallet fund

# Discover available paid services
tempo wallet services --search ai
```

Make a paid HTTP request:

```sh
# Preview payment details
tempo request --dry-run https://example.mpp.tempo.xyz/v1/resource

# Pay and retry automatically
tempo request https://example.mpp.tempo.xyz/v1/resource
```

Session-based services open a reusable payment channel:

```sh
tempo request -X POST \
  --json '{"input":"hello"}' \
  https://service.mpp.tempo.xyz/v1/stream

tempo wallet sessions list
tempo wallet sessions close https://service.mpp.tempo.xyz
```

## Commands

`tempo wallet` includes:

- `login`, `logout`, `refresh`, `whoami`, `keys`
- `fund`
- `transfer`
- `services`
- `sessions list`, `sessions close`, `sessions sync`
- `debug`
- `completions`

Credit-related flows use `whoami --credits`, `fund --credits`, and `transfer --credits`.

`tempo request` supports common curl-style flags for methods, headers, bodies, output files, redirects, retries, proxies, and streaming responses.

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
