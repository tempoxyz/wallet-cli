# Using Tempo Wallet CLI

The [README](../README.md) has the short setup path. This guide covers behavior that matters when scripting payments, transferring funds, or recovering an uncertain result. Run `tempo wallet <command> --help` or `tempo request --help` for the current options.

## Login and funding

`tempo wallet login` starts a device-code flow. In a terminal it shows a code and URL and waits for approval in the wallet app. With `--no-browser --format json`, it returns a pending login that another process can finish:

```sh
tempo wallet login --no-browser --format json
tempo wallet login status --format json
```

The pending result includes `verification_url`, `user_code`, `expires_at`, and `_next`. `login status` polls at the wallet's interval unless `--interval` is set. A pending code is stored in `~/.tempo/wallet/pending-login.json` with private file permissions so another process can resume it; a new login replaces the old one. Denial or expiry returns `E_LOGIN_DENIED` or `E_LOGIN_EXPIRED`; a poll limit or network failure leaves the pending login available for retry. Logout cancels a pending login on the networks it removes. A completed login returns lowercase `accounts`, `chain_id`, and `network`.

`refresh`, `keys update`, `keys revoke`, and `logout --revoke` also ask for wallet-app approval. Add `--no-browser` or set `TEMPO_NO_BROWSER=1` to handle approval on another device. A declined `refresh` or `keys update` leaves the old key usable.

`tempo wallet fund` opens a funding page and returns immediately. `--mach` opens MACH checkout on mainnet; `--amount` prefills the USD amount. `fund status`, `fund --wait`, and `fund --timeout` are no longer available. Check the destination token with `tempo wallet balance --token <token>` or `tempo wallet whoami --mach` before spending. A balance increase alone does not identify a particular checkout.

`fund --no-browser --format json` returns the handoff URL for another device. `--address` can set a destination without a local login. MACH checkout accepts $5–$100 USD with at most two decimal places; general funding accepts a positive amount with up to six. The amount is an editable prefill, and a successful `fund` exit confirms only that the link was handed off. `--no-wait` and `--wait=false` remain no-op compatibility forms.

`fund --credits` is unavailable. Existing MPP Credits remain spendable through `transfer --credits`, but new credits cannot be purchased. See [legacy credits](#legacy-credits).

## Sending and swapping

Preview a transfer or swap before submitting it:

```sh
tempo wallet send 5 USDC.e <recipient> --dry-run
tempo wallet swap 10 USDC.e pathUSD --dry-run
```

The swap preview includes a minimum output. Use its `_next` command to submit; it pins that minimum while obtaining a fresh quote. Interactive sends ask for confirmation, and scripted sends require `--yes`. Every submitted swap requires `--yes`, including interactive ones.

Both commands accept `--idempotency-key <key>`. Give each intended transaction a new key and reuse that key for retries. A replay returns the recorded transaction instead of signing again. If a run reports `E_PAYMENT_OUTCOME_UNKNOWN`, the transaction may have been sent. Check `tempo wallet tx status <hash>` when a hash is available; otherwise inspect the wallet before deciding whether to retry.

A key is scoped to the wallet and network. Reusing it with different transfer or swap arguments fails with `E_USAGE`. A replay can report `success`, `reverted`, `pending`, or `not_found`; a claimed key without a recorded result returns `E_PAYMENT_OUTCOME_UNKNOWN` and signs nothing. Dry runs do not claim keys. Records are kept under `~/.tempo/wallet/idempotency/` and pruned after 30 days. `tx status` reads the chain and reports its hash, network, status, block, addresses, and fee when known.

The send preview shows the fee token, estimated fee, wallet balance, fee-token balance, and `sufficient_balance` (`null` when a needed lookup fails). The confirmed command pins its reviewed fee token. A swap preview pins `--min-amount-out`, or `--max-amount-in` for `--exact-out`; submission obtains a new quote and enforces that bound. An interactive send can use wallet-app approval when the access key cannot sign; agent runs need a usable key. A send or swap on a network other than the logged-in wallet's network is refused before submission.

Token arguments accept a full address or a listed symbol on the selected network. A bridged token can also be named without `.e` (`USDC` resolves to `USDC.e`). `tempo wallet transfer <amount> <token> <to>` is a deprecated alias for `send`. `transfer --mach` settles a captured payment challenge; `transfer --credits` supports both captured challenges and direct legacy-credit payments.

### Balances and access keys

`tempo wallet balance` shows spendable tokens, including the network's default token even at zero; `--token` reads one token on chain. `tempo wallet whoami` separately reports available funds, active-session `locked` deposits, and `pending_refund` from closing sessions. `total` includes all three, but pending refunds cannot be spent until withdrawn. `tempo wallet address --qr` draws a receive QR code in a terminal. Balance and address require a login but no usable access key.

In `whoami`, `ready` means the wallet is logged in, its key is ready or pending, and the balance query succeeded; it does not mean a particular payment is affordable. If the balance RPC fails, `balance.available` and `balance.total` are `null`, `balance.error` explains the failed read, and `ready` is false rather than reporting zero. `keys list` and `whoami` show each key's chain `published` state and `spending_limits[].remaining` when readable. An unreadable key balance has `balance_error`. `spent` remains `null` because the chain exposes only the remaining limit. `spending_limit` is a deprecated single-limit compatibility field.

Preview an irreversible revocation with `tempo wallet keys revoke <access-key> --dry-run`. The command can revoke a key stored locally or one the chain shows authorized for the logged-in wallet; it asks for confirmation in a terminal and requires `--yes` elsewhere. It keeps the local key if the chain does not confirm revocation. `tempo wallet revoke` is a deprecated alias.

`tempo wallet logout` removes local keys on all networks, or one with `--network`. Without `--revoke`, those keys remain authorized on chain until expiry. `logout --revoke` asks the wallet app to revoke them first, on each key's network. Logout warns about stored sessions holding unspent deposits: logging out does not withdraw them, and you must log in again to close them. Such a logout, or any `--revoke`, needs confirmation. A failed on-chain revocation keeps the affected key locally.

## Paid requests and sessions

A dry run sends an HTTP probe and reads a `402` offer without paying. For POST and other methods that can change server state, the probe itself can have side effects.

```sh
tempo request --dry-run https://example.mpp.tempo.xyz/v1/resource
tempo request --payment-intent charge --max-spend 1 https://example.mpp.tempo.xyz/v1/resource
```

Replace the example URL with the service endpoint. `--payment-intent auto` prefers a reusable session. The default spending cap is 10 payment-token units for charges and sessions. An over-cap initial offer is refused before payment; a reused-session quote can instead report `within_budget: false`. If a service requests a top-up after receiving a session voucher, the cap may refuse the top-up after that voucher was sent. Check `tempo wallet sessions list` before retrying the request. A recurring subscription is not bounded by the default cap. An explicit `--max-spend` or a charge/session intent refuses a subscription offer.

The dry-run quote reports the offered `amount` and `token`, plus `max_spend` and `within_budget`. For sessions it reports `session` (`open` or `reuse`) and the `deposit` to lock or top up. It also reports `chain_id`, `network`, and the payer's balance and access-key limit when readable; unavailable reads remain `null`. A subscription quote has `max_spend: null` and `within_budget: null`. A non-402 response instead reports `payment_required: false` and its HTTP status.

Use `--payment-token <symbol-or-address>` when a service offers multiple tokens. `--payment-intent auto` does not silently switch from a failed reusable session to a nonrefundable charge; retry explicitly with `--payment-intent charge` if you accept it. An over-cap refusal can suggest a higher cap, but inspect the offer before rerunning it. The CLI redacts credentials in suggested commands.

A session locks a deposit. List sessions with `tempo wallet sessions list`. `tempo wallet sessions close <channel-id-or-origin>` requests a close; after the grace period, rerun it or use `--finalize` to withdraw the unspent deposit. Closing is irreversible and needs confirmation. `--cooperative` asks the service to close immediately when supported.

Use `sessions close --dry-run` to inspect selected channels and their states (`active`, `closing`, `finalizable`, `finalized`, or `orphaned`). A pending close is a successful request, not a withdrawal; `remaining_seconds` shows the wait before finalization. The local record is kept until the chain confirms closure. A close on another network is refused with a command pointing to that network. In scripts, use the result's `_next` to finalize after the grace period.

Successful paid requests print a short receipt on stderr in human output. Structured output (`-j` or `--format`) suppresses that summary; use `--write-meta <file>` to save response metadata and any payment receipt. If delivery fails after a payment, `E_PAYMENT_OUTCOME_UNKNOWN` means payment may have completed. A transaction hash or session reference helps investigate but is not proof of settlement. Check saved metadata and ask the provider before paying again.

Saved payment metadata includes the `intent`, `amount`, `token`, `payer`, `chain_id`, and `network`. It includes `tx_hash` when the server receipt provides one; a session also reports `session` (`open` or `reuse`), `channel_id`, `deposit_locked`, and its cumulative voucher. A subscription reports its billing `period` and `expires`, since it authorizes an amount per period. A receipt whose response body did not finish is marked `outcome: "unknown"`. Unpaid responses, HTTP errors after payment, and unconfirmed redirects do not report a confirmed receipt. HTTP errors return `E_HTTP` with the response body available through normal output options; transport failures return `E_NETWORK`.

`tempo request` accepts common curl-style method, header, body, proxy, redirect, and timeout flags. Output bytes are preserved, including binary data: use `-o <file>` to save them, `--stream` to write chunks as they arrive, or `--sse-json` to convert server-sent events to NDJSON. `tempo request` does not start a login or refresh: free responses need no wallet, while a payable 402 needs a usable signer. `--private-key` or `TEMPO_PRIVATE_KEY` can pay without a wallet login.

For a JSON endpoint, use `tempo request -X POST --json '{"input":"hello"}' <url>`. The request is sent before a 402 challenge is evaluated, including with `--dry-run`; inspect the method's side effects first.

For a one-time MACH charge, use `tempo request --mach --max-spend <amount> <url>` (or `--payment-token MACH`). The service must offer a machine-enabled charge; MACH does not pay for sessions. The merchant still receives its advertised settlement currency. Funding MACH does not convert legacy credits.

An explicit MACH selection does not fall back to a stablecoin and requires an explicit spending cap for payment. Insufficient MACH returns `E_INSUFFICIENT_FUNDS`; an insufficient stored key limit returns `E_LIMIT_EXCEEDED` with a `keys update` continuation. An unreadable balance returns retryable `E_NETWORK`; call-scope or swap-route failures return `E_PAYMENT`. `tempo wallet transfer --mach` can settle a captured challenge, but it does not deliver the credential to the merchant; prefer `tempo request` for the full flow.

## Legacy credits

`tempo wallet whoami --credits` shows the existing Coinflow balance. `tempo wallet transfer --credits --amount-cents <cap> --mpp-challenge-file <headers>` can pay a captured, unexpired push-payment challenge. A direct legacy payment uses `--amount-cents` and `--to`. `--dry-run` shows the destination and calldata without spending. `TEMPO_MAX_SPEND` also caps credit payments; `--max-spend` is for MACH.

Challenge payments require `--amount-cents` or `TEMPO_MAX_SPEND` as a cap, including quoted gas fees; a dry run needs no cap. Direct payments use whole USD cents. Challenge payments require push receipts and do not support splits. Do not mix `--mach` with `--credits`, positional token-transfer arguments with credits, or direct `--to`/`--data` with a challenge.

Coinflow quotes fees and executes the legacy transaction. Its permit authorizes the credit debit without binding the recipient or calldata, so review the dry run. Credit payments are deprecated; use `tempo request` for a complete MPP request and payment when possible.

## Networks and settings

Network selection is `--network`, then `TEMPO_WALLET_NETWORK`, then the saved `network`, then the logged-in wallet's network, then mainnet. With `TEMPO_PRIVATE_KEY` or `--private-key` for a request, the logged-in network is skipped. `mainnet`/`tempo` and `testnet`/`moderato`/`tempo-moderato` are aliases.

`tempo wallet config get` reports each effective setting and its source. `rpc-url` is saved per network; `TEMPO_RPC_URL` overrides every network. The CLI checks an override's chain before operations that could act on the wrong network. A saved `max-spend` applies to later payments as an explicit cap, including refusal of recurring subscriptions. Config changes ask for terminal confirmation or require `--yes` in scripts.

`config get` reports `flag`, `env`, `config`, `login`, or `default` as the source and redacts credentials in RPC URLs. Setting an `rpc-url` first checks that it answers the selected network's `eth_chainId`; an unreachable or wrong-chain URL is not saved. Before session reuse, session close or sync, key revocation, or `logout --revoke`, a custom RPC endpoint is checked again against the network. A saved network does not narrow `keys list` or `logout`; use `--network` or `TEMPO_WALLET_NETWORK` for that.

Settings are stored in `~/.tempo/wallet/config.json`. An invalid file makes commands that read it fail with `E_USAGE`; `tempo wallet doctor` reports the problem. `doctor` checks wallet, key, RPC, session store, and environment health on the selected network. It reports `ok`, `warn`, or `fail` per check and suggests a next command; an unhealthy report can still exit zero. `tempo wallet completions <shell>` generates shell completion scripts.

## Local state and output reference

Wallet state is under `~/.tempo/wallet/`: `store.json` holds the wallet and keys, `config.json` holds settings, `channels.db` holds session records, and `idempotency/` holds send and swap retry records. These files can contain access key material; keep them private and out of commits.

Wallet commands with a follow-up return `instruction` and `_next`. `_next.argv` is the authoritative argument vector, pinned to the resolved network; `_next.command` is a shell-quoted form. For a pending transaction or session close, the result can include a polling condition and interval. Run `tempo wallet --describe` for current command arguments and flags. The output schemas in [`src/schemas/`](../src/schemas/) and [`src/schemas/request.ts`](../src/schemas/request.ts) define the complete structured fields; the generated [command reference](commands.md) lists every mounted command.
