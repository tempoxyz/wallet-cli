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

A command-line wallet and HTTP client for [Tempo](https://tempo.xyz). `tempo wallet` manages your wallet, keys, tokens, and payment sessions. `tempo request` makes HTTP requests and handles [MPP](https://mpp.dev) payment challenges.

Use this CLI for terminal and script workflows. For payment handling inside an application, use an MPP SDK such as [mpp-rs](https://github.com/tempoxyz/mpp-rs), [mpp-go](https://github.com/tempoxyz/mpp-go), or [pympp](https://github.com/tempoxyz/pympp).

[Wallet](https://wallet.tempo.xyz) · [CLI docs](https://tempo.xyz/developers/docs/cli) · [Command reference](docs/commands.md) · [Usage guide](docs/usage.md)

## Install

Install the Tempo launcher, which manages the `wallet` and `request` extensions:

```sh
curl -fsSL https://tempo.xyz/install | bash
```

## Quick start

```sh
tempo wallet login
tempo wallet balance
tempo wallet services search ai
tempo request --dry-run https://example.mpp.tempo.xyz/v1/resource
tempo request https://example.mpp.tempo.xyz/v1/resource
```

`login` opens a device-code approval in the wallet app. Replace the example URL with a service endpoint. `request --dry-run` probes the endpoint and previews a payment without paying; a non-GET probe may still have server-side effects.

`balance` and `whoami` include MACH alongside the default currency, including zero balances. For an eligible charge, `request --dry-run` shows MACH under `mach`, separately from the advertised currency's balance and access-key limit.

To add funds, run `tempo wallet fund`. It opens the wallet app and returns a link; it does not wait for or confirm a deposit. Check `tempo wallet balance` after funding. To receive a transfer, run `tempo wallet address`.

## Common commands

| Task                        | Command                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| Check wallet and access key | `tempo wallet whoami`                                                 |
| Send tokens                 | `tempo wallet send <amount> <token> <recipient>`                      |
| Swap tokens                 | `tempo wallet swap <amount> <token-in> <token-out>`                   |
| Check a transaction         | `tempo wallet tx status <hash>`                                       |
| Manage payment sessions     | `tempo wallet sessions list` / `tempo wallet sessions close <target>` |
| Diagnose setup              | `tempo wallet doctor`                                                 |
| Make a paid HTTP request    | `tempo request <url>`                                                 |

Use `tempo wallet <command> --help` or `tempo request --help` for options. The [command reference](docs/commands.md) lists every wallet command; the [usage guide](docs/usage.md) covers remote login, transfers, payment choices, sessions, MACH, and legacy credits.

Preview a send or swap with `--dry-run`. Interactive sends ask for confirmation; every submitted swap needs `--yes`. Scripted sends, session closes, key revocations, and configuration changes also require `--yes`. Use a fresh `--idempotency-key` for each intended send or swap and reuse it on retries. If a payment or transaction reports `E_PAYMENT_OUTCOME_UNKNOWN`, check its status before trying again.

## Payments

`tempo request` handles supported `402 Payment Required` challenges. It prefers a reusable session when the server offers one; use `--payment-intent charge` for a one-time charge. A session locks a deposit until the session is closed and its unspent funds are withdrawn.

The default cap is 10 payment-token units for charges and sessions. Set `--max-spend <amount>`, `TEMPO_MAX_SPEND`, or the saved `max-spend` setting to change it. The default cap does **not** limit recurring subscriptions; choose `--payment-intent charge` or `session`, or set an explicit cap, to refuse them. Review the service's terms before authorizing a subscription.

For a receipt, pass `--write-meta <file>`. If the response fails after payment, the outcome may be unknown. Check the saved metadata and the provider before paying again. See [payment and session details](docs/usage.md#paid-requests-and-sessions).

## Configuration

`tempo wallet config` saves three settings:

| Setting     | Resolution order                                                              |
| ----------- | ----------------------------------------------------------------------------- |
| `network`   | `--network`, `TEMPO_WALLET_NETWORK`, saved setting, logged-in wallet, mainnet |
| `rpc-url`   | `TEMPO_RPC_URL`, saved URL for the selected network, default RPC              |
| `max-spend` | `--max-spend`, `TEMPO_MAX_SPEND`, saved setting, 10                           |

```sh
tempo wallet config get
tempo wallet config set network testnet
```

`config set` and `config unset` ask for confirmation in a terminal and require `--yes` in scripts. Use `--network` to select mainnet or testnet for a command. The [usage guide](docs/usage.md#networks-and-settings) explains RPC overrides and network-scoped behavior.

## Agents and scripts

`tempo wallet --mcp` serves wallet commands as MCP tools. `tempo wallet mcp add` registers the server with an agent, and `tempo wallet skills add` syncs skill files. Commands with a next step include structured `_next` guidance; use `--format json` for machine-readable output. Tool annotations and agent-specific guidance live in [SKILL.md](SKILL.md).

## Development

Requires Node.js 22 and pnpm 11.

```sh
pnpm install
pnpm check
pnpm docs:check
```

The release workflow publishes standalone macOS and Linux binaries with checksums, SBOMs, Sigstore bundles, and GitHub attestations. See [Releasing](docs/releasing.md) for runtime security checks and the shared wallet/request release procedure.

## Security and contributing

Report vulnerabilities to `security@tempo.xyz`, not public issues. Local files under `~/.tempo/` may contain access key material; do not commit them or `.env` files.

Use a Conventional Commit title and add a `.changelog/*.md` entry to pull requests. Run `pnpm check` before submitting changes. The command reference and MCP tool table are generated from command schemas with `pnpm docs:generate`.
