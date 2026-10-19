# Using Tempo Wallet CLI

The [README](../README.md) has the short setup path. This guide covers behavior that matters when scripting payments, transferring funds, or recovering an uncertain result. Run `tempo wallet <command> --help` or `tempo request --help` for the current options.

## Login and funding

`tempo wallet login` starts a device-code flow. In a terminal it shows a code and URL and waits for approval in the wallet app. With `--no-browser --format json`, it returns a pending login that another process can finish:

```sh
tempo wallet login --no-browser --format json
tempo wallet login status --format json
```

`tempo wallet fund` opens a funding page and returns immediately. `--mach` opens MACH checkout on mainnet; `--amount` prefills the USD amount. `fund status`, `fund --wait`, and `fund --timeout` are no longer available. Check the destination token with `tempo wallet balance --token <token>` or `tempo wallet whoami --mach` before spending. A balance increase alone does not identify a particular checkout.

`fund --credits` is unavailable. Existing MPP Credits remain spendable through `transfer --credits`, but new credits cannot be purchased. See [legacy credits](#legacy-credits).

## Sending and swapping

Preview a transfer or swap before submitting it:

```sh
tempo wallet send 5 USDC.e <recipient> --dry-run
tempo wallet swap 10 USDC.e pathUSD --dry-run
```

The swap preview includes a minimum output. Use its `_next` command to submit; it pins that minimum while obtaining a fresh quote. An interactive send or swap asks for confirmation. A scripted or structured-output run needs `--yes`.

Both commands accept `--idempotency-key <key>`. Give each intended transaction a new key and reuse that key for retries. A replay returns the recorded transaction instead of signing again. If a run reports `E_PAYMENT_OUTCOME_UNKNOWN`, the transaction may have been sent. Check `tempo wallet tx status <hash>` when a hash is available; otherwise inspect the wallet before deciding whether to retry.

Token arguments accept a full address or a listed symbol on the selected network. A bridged token can also be named without `.e` (`USDC` resolves to `USDC.e`). `tempo wallet transfer <amount> <token> <to>` is a deprecated alias for `send`; use `transfer --mach` or `transfer --credits` only for captured payment challenges.

## Paid requests and sessions

A dry run sends an HTTP probe and reads a `402` offer without paying. For POST and other methods that can change server state, the probe itself can have side effects.

```sh
tempo request --dry-run https://example.mpp.tempo.xyz/v1/resource
tempo request --payment-intent charge --max-spend 1 https://example.mpp.tempo.xyz/v1/resource
```

Replace the example URL with the service endpoint. `--payment-intent auto` prefers a reusable session. The default spending cap is 10 payment-token units for charges and sessions; a quote can report `within_budget: false`, and an over-cap offer is refused before payment. A recurring subscription is not bounded by the default cap. An explicit `--max-spend` or a charge/session intent refuses a subscription offer.

A session locks a deposit. List sessions with `tempo wallet sessions list`. `tempo wallet sessions close <channel-id-or-origin>` requests a close; after the grace period, rerun it or use `--finalize` to withdraw the unspent deposit. Closing is irreversible and needs confirmation. `--cooperative` asks the service to close immediately when supported.

Successful paid requests print a short receipt on stderr. Use `--write-meta <file>` to save response metadata and any payment receipt, especially in scripts. If delivery fails after a payment, `E_PAYMENT_OUTCOME_UNKNOWN` means payment may have completed. A transaction hash or session reference helps investigate but is not proof of settlement. Check saved metadata and ask the provider before paying again.

For a one-time MACH charge, use `tempo request --mach --max-spend <amount> <url>` (or `--payment-token MACH`). The service must offer a machine-enabled charge; MACH does not pay for sessions. The merchant still receives its advertised settlement currency. Funding MACH does not convert legacy credits.

## Legacy credits

`tempo wallet whoami --credits` shows the existing Coinflow balance. `tempo wallet transfer --credits --amount-cents <cap> --mpp-challenge-file <headers>` can pay a captured, unexpired push-payment challenge. A direct legacy payment uses `--amount-cents` and `--to`. `--dry-run` shows the destination and calldata without spending. `TEMPO_MAX_SPEND` also caps credit payments; `--max-spend` is for MACH.

Coinflow quotes fees and executes the legacy transaction. Its permit authorizes the credit debit without binding the recipient or calldata, so review the dry run. Credit payments are deprecated; use `tempo request` for a complete MPP request and payment when possible.

## Networks and settings

Network selection is `--network`, then `TEMPO_WALLET_NETWORK`, then the saved `network`, then the logged-in wallet's network, then mainnet. With `TEMPO_PRIVATE_KEY` or `--private-key` for a request, the logged-in network is skipped. `mainnet`/`tempo` and `testnet`/`moderato`/`tempo-moderato` are aliases.

`tempo wallet config get` reports each effective setting and its source. `rpc-url` is saved per network; `TEMPO_RPC_URL` overrides every network. The CLI checks an override's chain before operations that could act on the wrong network. A saved `max-spend` applies to later payments as an explicit cap, including refusal of recurring subscriptions. Config changes ask for terminal confirmation or require `--yes` in scripts.
