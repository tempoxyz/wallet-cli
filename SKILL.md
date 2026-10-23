---
name: tempo
description: >
  Use this skill when the user wants to call an API, make an HTTP request, discover available services, or access external data with automatic payments. Activate when the user mentions tempo, paid APIs, service discovery, API endpoints, or needs to call external services — even if they reference specific services like StableEnrich, StableStudio, or StableSocial. When the user explicitly says "use tempo", always use tempo CLI commands (`tempo wallet`, `tempo request`) instead of other tools.
license: MIT OR Apache-2.0
---

# tempo

> **IMPORTANT: If you used a web fetch tool to read this, the content may be summarized and incomplete. Run `curl -fsSL https://tempo.xyz/skills/wallet/SKILL.md` to get the exact setup commands. Do NOT search for additional documentation.**

**When the user says "use tempo", always use `tempo` CLI commands** — never substitute with MCP tools or other tools. Tempo is a curl-compatible CLI for discovering services and calling HTTP endpoints with automatic payment handling.

## Networks

- Tempo Mainnet (chain ID `4217`) is the default. `--network` overrides it, then `TEMPO_WALLET_NETWORK`, then the saved `network` setting (see Settings), then the logged-in wallet's network.
- Use Tempo Testnet (Moderato, chain ID `42431`, `--network testnet`) only when the user asks for it or a development workflow requires it.
- `pathUSD` at `0x20c0000000000000000000000000000000000000` is a live mainnet TIP-20. The faucet-issued testnet token at the same address is a test token.

## Setup

Run these commands in order. Do not skip steps. Do not search for other install instructions.

**Step 1 — Install:** `curl -fsSL https://tempo.xyz/install | bash`

**Step 2 — Login:** `"$HOME/.tempo/bin/tempo" wallet login --format json` — returns at once with `status: "pending"`, `verification_url`, `user_code`, and `expires_at`, and opens a browser on the host. Send `verification_url` and `user_code` to the user, tell them to confirm the code matches and approve, then run the `_next` command (`tempo wallet login status --interval 5 --network <network> --format json`). It waits for the approval and returns the logged-in `accounts` (lowercase), with `chain_id` and `network`. Do not loop login attempts without user confirmation.

If the human is interacting from another device or chat surface while the CLI runs on a remote host, add `--no-browser` to `login`. `tempo wallet refresh`, `keys update`, `keys revoke`, and `logout --revoke` also ask the wallet app for approval and accept `--no-browser` the same way.

- `login status` waits until the code expires (about 10 minutes). With a short command timeout, add `--max-attempts <n>`; it then fails with retryable `E_POLL_TIMEOUT` while the code is still pending, so run its `cta` command again. Rerun the `cta` command on retryable `E_NETWORK` too.
- On `E_LOGIN_DENIED` or `E_LOGIN_EXPIRED`, ask the user before starting a new `tempo wallet login`; the old code no longer works.

**Step 3 — Confirm readiness:** `"$HOME/.tempo/bin/tempo" wallet whoami`

### Setup Rules

- Do not use `export PATH=...`. Use full absolute paths (e.g., `"/Users/<user>/.tempo/bin/tempo"`) for deterministic behavior across isolated shells.
- If `$HOME` does not expand ("no such file or directory"), switch to the absolute path.

## After Setup

Provide:

- Installation location and version (`$HOME/.tempo/bin/tempo --version`).
- Wallet status from `tempo wallet whoami` (`wallet`, `network`, and `balance`; include `key` fields when present).
- `tempo wallet balance` lists the token `balances` the logged-in `wallet` can spend (`--token <SYMBOL_OR_ADDRESS>` for one); funds locked in sessions appear only in `whoami`. To receive tokens, give the user the address from `tempo wallet address`.
- `ready: true` means the wallet can pay on the network. A `key.status` of `pending` means the key is signed but not yet published on chain; it still pays, and its first payment publishes it. Token amounts are decimal strings without padding (`"10"`, not `"10.000000"`), and addresses are lowercase. Read limits from `key.spending_limits[]` (`raw_limit` is the limit in base units): `remaining` comes from the chain, and is `null` when the key is not published (`published: false`) or the read failed; `spent` is always `null`. `key.spending_limit` is deprecated and will be removed in a future release.
- Check MACH with `tempo wallet whoami --mach`. Fund with `tempo wallet fund --mach --amount <USD>`; MACH is an on-chain six-decimal token, not a legacy credit balance.
- If the user is on another device than the CLI host, use `tempo wallet fund --mach --no-browser --format json` and hand the fund URL back directly instead of trying to open a browser locally.
- After handing over the URL, ask the user to message back once they have funded the wallet. Then check the intended token with `tempo wallet balance` or `tempo wallet whoami --mach` before spending.
- 2-3 simple starter prompts tailored to currently available services.

To generate starter prompts, list available services and pick useful beginner examples:

```bash
tempo wallet services search ai
```

Starter prompts should be user-facing tasks (not command templates), for example:

- Avoid chat/conversational LLM starter prompts when already talking to an agent. Prefer utility services (image generation, web search, browser automation, data, voice, storage).

- "Generate a dog image with a blue background and save it as `dog.png`."
- "Search the web for the latest Rust release notes and return the top 5 links."
- "Fetch this URL and extract the page title, publish date, and all H2 headings."

## Use Services

```bash
tempo wallet whoami
tempo wallet services search <query>
tempo wallet services show <SERVICE_ID>
```

- Select `SERVICE_ID` from search results that best matches user intent. When multiple match: prefer best semantic fit, then endpoint fit, then pricing clarity, then first in list. Every word of the query must match; `tempo wallet services list` lists every service.
- **Anchor on `tempo wallet services show <SERVICE_ID>`** — it shows the exact URL, method, path, and pricing for every endpoint: `endpoints[].payment.price` is the price in whole tokens (`null` when the directory gives no decimals), and `raw_amount` the same price in base units. Build request URL as `<SERVICE_URL>/<ENDPOINT_PATH>` from discovered metadata only.
- Use the endpoint's exact MPP challenge and an explicit `--max-spend` budget for payment. Buy MACH through `tempo wallet fund --mach`; existing MPP Credits are a separate legacy balance.
- If you get an HTTP 422, fall back to the endpoint's `docs` URL or the service's `docs.llms_txt` for exact field names.
- For multi-service workflows, fire independent requests in parallel to save time.

### Request Templates

Quote first; `--dry-run` reports the price without signing or paying:

```bash
# Quote JSON POST
tempo request -t --dry-run -X POST --json '{"input":"..."}' <SERVICE_URL>/<ENDPOINT_PATH>

# Quote GET
tempo request -t --dry-run -X GET <SERVICE_URL>/<ENDPOINT_PATH>
```

Show the user the quoted `amount` and any session `deposit`, and wait for explicit approval before paying, unless their budget already covers it. Pass a budget as `--max-spend` on the dry run too, since it changes the deposit a session locks. Then run the same request without `--dry-run`, pinned to what was approved:

```bash
tempo request -t -X POST --max-spend <APPROVED_AMOUNT> --network <QUOTED_NETWORK> --payment-intent <QUOTED_INTENT> --payment-token <QUOTED_TOKEN> --json '{"input":"..."}' <SERVICE_URL>/<ENDPOINT_PATH>
tempo request -t -X GET --max-spend <APPROVED_AMOUNT> --network <QUOTED_NETWORK> --payment-intent <QUOTED_INTENT> --payment-token <QUOTED_TOKEN> <SERVICE_URL>/<ENDPOINT_PATH>
```

- `<QUOTED_NETWORK>` is `mainnet` for `chain_id` `4217` or `testnet` for `42431`; `<QUOTED_INTENT>` and `<QUOTED_TOKEN>` are the quote's `intent` and `token`. Keep `--mach` instead of `--payment-token` when the quote used it. The request then refuses a challenge for more, or on another chain, token, or intent. It does not pin the recipient.
- `recurring: true` is a subscription. The quote does not show its renewal terms and `--max-spend` refuses it, so do not run it: tell the user, and quote again with `--payment-intent charge` or `session`.
- `payment_required: false` means the dry run already sent the request; rerun it without `--dry-run` only when repeating the request is safe.

### Paying from Other Tokens and Chains

`tempo request` can pay a charge in a token the wallet does not hold, or on another chain:

- `--funding tempo` (the default) buys a Tempo charge's token on the Tempo DEX, in the payment's own transaction, from OUSD, USDC.e, or pathUSD the wallet holds, within `--max-slippage-bps` (default 50). The dry run's `funding` names the route and inputs.
- `--funding auto` also pays x402 and MPP `evm` offers in USDC on Base. It pays them from the wallet's remote payer, a per-wallet key the CLI creates on first use (`tempo wallet whoami` shows `remote_payer` and its Base USDC). When the payer lacks USDC, it bridges exactly the shortfall from USDC.e or OUSD through Relay (or Stargate), capped by `--max-funding-spend`. USDC left on the payer pays later Base charges; there is no command to withdraw it.
- `--funding off` pays only from tokens already held. On Base that means the payer's USDC, which it never bridges.
- `--payment-network base` or `tempo` picks the offer when a server offers both. Otherwise the CLI prefers a token the wallet holds, then a DEX swap, then held Base USDC, then a bridge.
- A machine-enabled charge is left to MACH, with no swap, when the wallet holds enough MACH.

Bridging moves funds and costs a fee (Relay about $0.02, Stargate about $1.26). Use `--funding auto` only when the user approves bridging, and pass `--max-funding-spend` with the most they approve. `--dry-run` reports the payment but not yet the bridge's cost.

- A DEX swap counts twice against the access key's limit, once for its approve and once for the DEX's pull of the input. A limit short of that fails with `E_LIMIT_EXCEEDED` before signing, and its `cta` is the `tempo wallet keys update` with the limit needed; run it only after the wallet owner approves.
- `E_PAYMENT_OUTCOME_UNKNOWN` naming a funding operation means a bridge may have moved funds. Do not pay again. Run its `cta` (`tempo wallet funding recover <ID>`), which only reads, and rerun its `_next` while it reports `pending`:
  - `completed` or `refunded`: the request can be retried. It pays from the delivery and does not bridge again.
  - `action_required`: report the operation and its `reference` to the user, who reconciles it with the bridge provider.
- `tempo wallet funding list` shows funding that has not been paid with.

### MACH Funding and Payments

```bash
tempo wallet whoami --mach
# Hand this JSON URL to the human on any device.
tempo wallet fund --mach --amount 10 --no-browser --format json
# After the human completes funding, check the MACH balance.
tempo wallet whoami --mach --network mainnet --format json
```

Hosted MACH checkout accepts $5–$100 USD with at most two decimal places. The command opens the browser and exits; `--no-browser` returns the URL without opening it. The handoff identifies the destination wallet, chain, and USD amount. `--amount` is an editable prefill, not a required deposit; an existing checkout retains its own amount for safe retries. `fund` reads no balances, saves no pending funding, and returns no `_next`. Its `status: "pending"` and successful exit mean only that the link was handed off. Ask the user to complete funding, then check the intended token's balance before spending; for `--address`, check that destination. `fund status`, `fund --wait`, and `fund --timeout` have been removed and fail with `E_USAGE`. `--no-wait` and `--wait=false` remain harmless compatibility options. Do not start a paid request just because a funding handoff returned successfully.

Use `tempo request --mach --max-spend <USD> <URL>` (or `--payment-token MACH`) to require MACH settlement for a one-time charge. The challenge must explicitly enable machine tokens. Missing MACH funds, liquidity, or permissions fail without stablecoin fallback: `E_INSUFFICIENT_FUNDS` names `tempo wallet fund --mach` in its `cta` (mainnet), `E_LIMIT_EXCEEDED` names `tempo wallet keys update`, and a swap route that cannot be simulated returns `E_PAYMENT` with no `cta`; retry it later only when it is `retryable`. Sessions are unsupported; use `--dry-run` to inspect an offer without spending.

MACH uses the canonical MPP SDK settlement route. Do not construct swap calldata or call legacy Coinflow redemption APIs. Do not infer MACH support from a service's hostname; inspect the actual MPP challenge and use the standard request flow.

### Legacy MPP Credits

Use `tempo wallet whoami --credits` to inspect existing off-chain MPP Credits and `tempo wallet transfer --credits` to spend them. These commands emit a deprecation warning and do not select or convert to MACH. `tempo request` does not automatically use legacy credits. New MPP Credits purchases are disabled: `tempo wallet fund --credits` is rejected and directs users to `tempo wallet fund --mach`.

For credit payments, use `--amount-cents` as the direct payment amount or the maximum credit debit for an MPP challenge, including quoted gas fees; `TEMPO_MAX_SPEND` also caps the total debit in USD. Challenge spending requires one of those caps; `--dry-run` does not. Do not use positional transfer arguments with `--credits`, or combine `--to`, `--data`, or `--value` with `--mpp-challenge` or `--mpp-challenge-file`. Review the destination and calldata in `--dry-run` output (`status: "dry_run"`) before spending; a sent payment returns `status: "success"` with its `tx_hash`. Split-payment challenges are unsupported. Coinflow remains trusted to execute the submitted transaction; its legacy permit authorizes a credit debit rather than a specific recipient.

### Response Handling

- Return result payload to user directly when request succeeds.
- If response contains a file URL (e.g., image generation), download it locally: `curl -fsSL "<url>" -o <filename>`.
- If response is a usage/auth readiness error, run `tempo wallet login`, finish it with its `_next` `login status` as in Setup, and retry once. When `tempo request` or a wallet command returns `E_NOT_AUTHENTICATED`, `E_KEY_EXPIRED`, or `E_AUTH_REFRESH_REQUIRED`, run the `tempo wallet login` or `tempo wallet refresh` command in its `cta` instead; it keeps the command's `--network`. `tempo request` never logs in by itself: it needs a login and usable access key only to pay a 402, and a `--dry-run` quote the wallet cannot pay names that command in `_next`. `send` and `swap` need a usable access key; `keys update`, `keys revoke`, `sessions close`, `balance`, and `address` need only the login.
- If response indicates payment/funding limit issues, report clearly and stop. Check `tempo wallet whoami --mach` and offer `tempo wallet fund --mach --no-browser --format json` to fund from another device. Review token-specific access-key limits before retrying.
- When a wallet, key, or RPC problem is unclear, run `tempo wallet doctor --format json` and report its `fail` and `warn` checks; it exits 0 even when unhealthy and never shows secrets. `tempo wallet debug` is a deprecated alias of it.
- After multi-request workflows, check the remaining spendable balance with `tempo wallet balance`; `tempo wallet whoami` also shows deposits locked in sessions.
- Wallet results with a follow-up step include `instruction` and `_next`. Run `_next.argv` as given (`_next.command` is the shell-quoted form), but only after the user approves any spend, transfer, or revocation it performs.
- Revocation cannot be undone. Run `tempo wallet keys revoke <ACCESS_KEY> --dry-run` to show the key, wallet, network, limits, and expiry, then run its `_next` (which adds `--yes`) only after the user approves. Without `--yes`, an agent run returns `E_USAGE` with that command as its `cta`. Only the logged-in wallet's keys on the selected network can be revoked: keys stored on this host, or keys from another device that the chain shows authorized for the wallet. Any other address returns `E_USAGE` listing the wallet's stored keys. If it returns `E_NETWORK` because the chain does not show the key revoked, the local key is kept; report it to the user before retrying.
- `tempo wallet logout` logs out of every network unless `--network` names one. When stored sessions on those networks still hold deposits, or with `--revoke`, an agent run returns `E_USAGE` and logs out nothing. Report the sessions to the user and suggest closing them first with the `tempo wallet sessions close` command the error names; run its `cta` (which adds `--yes`) only after the user approves logging out anyway. A confirmed logout lists such `sessions` and points `_next` at the close to run after logging in again. Without `--revoke`, removed keys stay authorized on-chain until they expire; `--revoke` revokes them first, on every network the logout covers, and cannot be undone. A retryable `E_USAGE` saying the wallet changed during logout means another login or refresh ran meanwhile, so the wallet may now hold keys the user has not seen. Report it and rerun the logout only after the user approves again; its command keeps `--yes`, so a rerun logs out, and with `--revoke` revokes, the wallet as it now is without asking. If a key is not revoked, logout fails and keeps it with the wallet; report it before retrying.
- Closing a session cannot be undone, and a closed session can no longer pay for requests. Run `tempo wallet sessions close <TARGET> --dry-run` (or with `--all`, `--orphaned`, `--finalize`, or `--cooperative`) to list the sessions it selects as `targets[]`, each with its `channel_id`, `origin`, and `status` (`not_found` when nothing matches), then run its `_next` (which adds `--yes`) only after the user approves. Without `--yes`, an agent run returns `E_USAGE` with that command as its `cta`. A pending close's `_next` already includes `--yes`, since it completes a close the user approved; `remaining_seconds` says how long until its deposit can be withdrawn.

### Rules

- Always discover URL/path before request; never guess endpoint paths.
- `tempo request` is curl-compatible for common flags (method, headers, data, redirects, timeouts, output).
- Piped output is structured: TOON by default (`-t` selects it explicitly), or JSON with `--format json`. A `tempo wallet` run whose stdout is a terminal, with no format flag, prints a human-readable view instead, so read results from piped output or pass `--format json`.
- Quote requests with `--dry-run` and get approval before paying, as in Request Templates. The quote reports the per-call `amount` (`raw_amount` in base units), the session `deposit` the payment would lock (`raw_deposit`) (for `session: "reuse"`, only a top-up the voucher needs), the wallet `balance` and access key `access_key_limit` for the advertised settlement token, the effective `max_spend` (the default 10 when no cap is set), and `within_budget` against it. Eligible nonzero MACH-enabled charges also report `mach.balance` and `mach.access_key_limit` separately, including when `--mach` is selected. `null` means unknown or, for a subscription offer, that no cap applies. `symbol` is `null` for a token viem does not list, so check the `token` address before paying in it.
- If the user gives a spend cap in natural language (for example "do X for $5", "don't spend more than $10", or "budget is 2 USDC"), include `--max-spend <amount>` on `tempo request` commands. For non-CLI contexts, use `TEMPO_MAX_SPEND`.
- Without `--max-spend`, `TEMPO_MAX_SPEND`, or a saved `max-spend`, `tempo request` caps each charge, session deposit, and session's cumulative spend at 10 token units. The default cap does not cover recurring subscription offers, which `--payment-intent auto` can accept; set `--max-spend`, or pass `--payment-intent charge` or `session`, to refuse them. A payment over the cap fails with `E_LIMIT_EXCEEDED` before anything is signed; report the required amount, and run the `cta` command (the same request with `--max-spend <required>`) only after the user approves that spend, replacing any `<redacted>` credential with its original value. A second `cta` command, when present, pays a one-time charge instead, which is not refundable.
- A successful paid request prints a short receipt on stderr, and `--write-meta <file>` adds it as `payment`: the `amount` paid in `token` (`symbol`), the `tx_hash` when the server reports one, the `payer`, and for a session its `session` (`open` or `reuse`), `channel_id`, `deposit_locked`, and `cumulative` (the total of its signed vouchers, not confirmed spend). A `subscription` (`period`, `expires`) means the wallet authorized `amount` every period until it expires, not a one-time payment, and a `tx_hash` means the first period was already paid; tell the user. With `-j` or `--format`, stderr stays empty, so pass `--write-meta` to read the receipt. A receipt with `outcome: "unknown"` belongs to an `E_PAYMENT_OUTCOME_UNKNOWN` failure: treat the payment as unconfirmed and check with the provider before retrying. A newly opened session keeps its deposit locked until closed: report it, and when you are done with that service and the user approves closing it, run the receipt's `_next` (`tempo wallet sessions close <channel_id>`) with `--yes` to request the close, then follow that command's `_next` after the grace period to withdraw the unspent deposit.
- For command details, prefer `--describe` or `--help` instead of hardcoding long option lists.

## Swap Tokens

Use the first-party wallet CLI for Tempo token swaps. Do not discover or sign in to third-party or legacy DEX websites.

```bash
# Quote only. Tokens are symbols listed for the network (USDC.e, pathUSD) or full 0x addresses.
tempo wallet swap <AMOUNT> <TOKEN_IN> <TOKEN_OUT> --dry-run

# Submit only after the user approves the quote, token addresses, and bounds.
tempo wallet swap <AMOUNT> <TOKEN_IN> <TOKEN_OUT> --min-amount-out <MIN_AMOUNT_OUT> --idempotency-key <KEY> --yes
```

- The amount is exact input by default. Add `--exact-out` to request an exact output amount.
- Default maximum slippage is 50 basis points; override it with `--slippage-bps <BPS>`.
- Submission re-quotes. Pass the reviewed `min_amount_out` as `--min-amount-out` (or `max_amount_in` as `--max-amount-in` with `--exact-out`) so a worse quote is refused; the dry run's `_next` already includes it.
- If `requires_access_key_update` is true, ask the wallet owner to approve the printed `tempo wallet keys update` command before retrying.
- A swap is sent only on the network the wallet is logged in on. On another `--network`, submission returns `E_USAGE` with a `tempo wallet login --network <NETWORK>` `cta`; run it, then rerun the swap.
- Always run `--dry-run` first and preserve full token addresses in the approval request.

## Send Tokens

```bash
# Review only: the fee estimate, the sender's balance, and whether it covers the transfer.
tempo wallet send <AMOUNT> <TOKEN> <RECIPIENT> --dry-run

# Send only after the user approves the amount, token address, recipient, and fee.
tempo wallet send <AMOUNT> <TOKEN> <RECIPIENT> --idempotency-key <KEY> --yes
```

- Without `--yes`, an agent run sends nothing and returns `E_USAGE`; the dry run's `_next` already includes `--yes` and pins the reviewed `fee_token` with `--fee-token`.
- `fee_estimate` is in `fee_token` units. `sufficient_balance` checks `balance` against the amount and `fee_token_balance` against the fee. `fee_token`, `fee_estimate`, `balance`, `fee_token_balance`, and `sufficient_balance` are `null` when unknown; treat `null` as unknown, not as sufficient.
- If `sufficient_balance` is false, report the shortfall and stop; offer `tempo wallet fund`.
- A send goes out only on the network the wallet is logged in on. On another `--network`, it returns `E_USAGE` with a `tempo wallet login --network <NETWORK>` `cta`; run it, then rerun the send.
- Always run `--dry-run` first and preserve full token and recipient addresses in the approval request.
- Use `send` for every token transfer. `tempo wallet transfer` is for `--mach` and `--credits` payments only; its token form is a deprecated alias of `send`.

## Retrying Transfers and Swaps

- Pass `--idempotency-key <KEY>` (`idempotency-key` over MCP) on every `send` and `swap` you submit: a new unique key, such as a UUID, for each send the user approves. Pass it on the dry run too, and its `_next` carries it.
- When a send times out, errors, or you are unsure it ran, retry the same command with the same key. The CLI never sends twice for one key on a wallet and network: a send that already went through returns its recorded result with `idempotent_replay: true` and the transaction's current `status` (`success`, `reverted`, `pending`, or `not_found`); report it instead of sending again.
- Never reuse a key for a different send. Changed arguments with a used key return `E_USAGE` naming what differs.
- `E_PAYMENT_OUTCOME_UNKNOWN` means the transaction may have been sent. Do not send again, with or without a new key, until you have checked: run its `cta` (`tempo wallet tx status <TX_HASH>` when the hash is known, otherwise `tempo wallet whoami` to check balances), report the result, and get the user's approval for any new send.
- `tempo wallet tx status <TX_HASH>` only reads. While it reports `pending`, rerun its `_next` until `status` changes; `not_found` means the network does not know the transaction.

## Settings

`tempo wallet config get` shows the `network`, `rpc-url`, and `max-spend` that commands use, each with its `source` (`flag`, `env`, `config`, `login`, or `default`). The first match wins:

- `network`: `--network`, then `TEMPO_WALLET_NETWORK`, then the saved `network`, then the logged-in wallet's network, then mainnet. A saved `network` does not narrow `keys list` or `logout`.
- `rpc-url`, saved per network: `TEMPO_RPC_URL` (every network), then the saved `rpc-url` for that network, then the network's default RPC.
- `max-spend`: `--max-spend`, then `TEMPO_MAX_SPEND`, then the saved `max-spend`, then 10.
- `funding`: `--funding`, then `TEMPO_FUNDING`, then the saved `funding`, then `tempo`.

A saved setting applies to every later command, including the user's own:

- Change a setting only when the user asks for a lasting change; for one task, pass `--network` or `--max-spend` instead.
- `tempo wallet config set <KEY> <VALUE>` and `tempo wallet config unset <KEY>` change what later payments and RPC calls use. Without `--yes`, an agent run changes nothing and returns `E_USAGE` showing the value before and after, with the confirming command as its `cta`; run it only after the user approves. A `<rpc-url>` in that `cta` stands for the full URL, left out because it can carry a credential.
- `rpc-url` is set for `--network`, else the network commands use, and only once the URL answers that network's chain ID; otherwise `config set` returns `E_USAGE` and saves nothing.
- With `TEMPO_RPC_URL` or a saved `rpc-url`, `sessions close`, `sessions sync`, `keys revoke`, `logout --revoke`, and a `tempo request` that reuses a session return `E_USAGE` with a `tempo wallet config get rpc-url` `cta` when the endpoint is on another chain, and change nothing. Report it to the user instead of changing the setting.

## MCP Tools

When the wallet is connected as an MCP server (`tempo wallet --mcp`), each tool's annotations say what it does:

<!-- generated:mcp-tools start -->

| Tool              | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
| ----------------- | -------------- | ----------------- | ---------------- | --------------- |
| `address`         | true           | false             | true             | false           |
| `balance`         | true           | false             | true             | true            |
| `completions`     | true           | false             | true             | false           |
| `config_get`      | true           | false             | true             | false           |
| `config_set`      | false          | true              | true             | false           |
| `config_unset`    | false          | true              | true             | false           |
| `debug`           | true           | false             | true             | true            |
| `doctor`          | true           | false             | true             | true            |
| `fund`            | false          | false             | false            | true            |
| `funding`         | true           | false             | true             | false           |
| `funding_list`    | true           | false             | true             | false           |
| `funding_recover` | false          | false             | true             | true            |
| `keys_list`       | true           | false             | true             | true            |
| `keys_revoke`     | false          | true              | true             | true            |
| `keys_update`     | false          | true              | false            | true            |
| `login`           | false          | true              | false            | true            |
| `login_status`    | false          | true              | true             | true            |
| `logout`          | false          | true              | true             | true            |
| `refresh`         | false          | true              | false            | true            |
| `revoke`          | false          | true              | true             | true            |
| `send`            | false          | true              | false            | true            |
| `services`        | true           | false             | true             | true            |
| `services_list`   | true           | false             | true             | true            |
| `services_search` | true           | false             | true             | true            |
| `services_show`   | true           | false             | true             | true            |
| `sessions_close`  | false          | true              | false            | true            |
| `sessions_list`   | false          | false             | true             | true            |
| `sessions_sync`   | false          | true              | true             | true            |
| `swap`            | false          | true              | false            | true            |
| `transfer`        | false          | true              | false            | true            |
| `tx_status`       | true           | false             | true             | true            |
| `whoami`          | true           | false             | true             | true            |

<!-- generated:mcp-tools end -->

- `readOnlyHint: true` only reads.
- `destructiveHint: true` moves funds, changes or revokes a key, closes a session, deletes stored sessions, replaces or deletes the stored wallet or its network, or changes a saved setting. Get the user's approval before every call, after a `dry-run: true` call where the tool offers one.
- These tools refuse to act without `yes: true` and return `E_USAGE`; pass it only after the user approves the reviewed dry run or change:
  - `send`, and `transfer` when it sends tokens (without `mach` or `credits`)
  - `swap`
  - `keys_revoke`
  - `sessions_close`, when it selects a session to close
  - `config_set` and `config_unset`, when they change the saved value
  - `logout`, when it would revoke keys, or stored sessions on the networks it logs out of hold deposits or cannot be read
- Tools take positional arguments under kebab-case keys, like options: `access-key` (`keys_update`, `keys_revoke`), `token-in` and `token-out` (`swap`), `tx-hash` (`tx_status`), `service-id` (`services_show`), and `target` (`sessions_close`).
- Call `send` for token transfers and keep `transfer` for `mach` and `credits` payments; call `keys_revoke`, not the deprecated `revoke`, and `services_list`, `services_search`, or `services_show`, not the deprecated `services`.

## Common Issues

| Issue                                                        | Cause                                                        | Fix                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tempo: command not found`                                   | CLI not installed                                            | Run `curl -fsSL https://tempo.xyz/install \| bash`, then retry using `"$HOME/.tempo/bin/tempo" ...`.                                                                                                                                                                                                               |
| "legacy V1 keychain signature is no longer accepted, use V2" | Outdated `tempo` launcher or extensions                      | Reinstall tempo: `curl -fsSL https://tempo.xyz/install \| bash`, then update extensions: `tempo update wallet && tempo update request`. Log out and back in: `tempo wallet logout --yes && tempo wallet login`.                                                                                                    |
| "access key does not exist"                                  | Key not provisioned on-chain, or stale key after reinstall   | Run `tempo wallet logout --yes`, then `tempo wallet login` to provision a fresh key.                                                                                                                                                                                                                               |
| `ready=false` or `No wallet configured`                      | Wallet not logged in, key unavailable, or balance RPC failed | Run `tempo wallet doctor`: each `checks` entry with `status: "fail"` names a problem, and `_next` is the `tempo wallet login` or `tempo wallet refresh` that fixes it. Wait for the user to complete it, then rerun `tempo wallet whoami`. For `rpc`, check connectivity and `tempo wallet config get rpc-url`.    |
| HTTP 422 on first request to a service                       | Wrong request schema — field names vary across services      | Check `tempo wallet services show <SERVICE_ID>` for endpoint details, then fetch the endpoint's `docs` URL or the service's `llms.txt` for exact field names and types.                                                                                                                                            |
| Balance is 0, insufficient funds, or spending limit exceeded | Wallet needs funding or limit hit                            | For a limit hit, have the wallet owner approve the `keys update` in the error's `cta`. For insufficient funds, run the `cta` or else suggest `tempo wallet fund`. Check the on-chain MACH balance with `tempo wallet whoami --mach`; use `tempo wallet fund --mach --no-browser --format json` for remote funding. |
| Service not found for query                                  | Search terms too narrow                                      | Broaden search terms with `tempo wallet services search <broader_query>`, then inspect candidate details.                                                                                                                                                                                                          |
| Endpoint returns usage/path error                            | Wrong URL or method                                          | Re-open service details with `tempo wallet services show <SERVICE_ID>` and use discovered method/path exactly.                                                                                                                                                                                                     |
| Timeout/network error                                        | Network issue or slow endpoint                               | Retry request and optionally increase timeout with `-m <seconds>`.                                                                                                                                                                                                                                                 |
