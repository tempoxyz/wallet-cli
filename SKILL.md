---
name: tempo
description: >
  Use this skill when the user wants to call an API, make an HTTP request, discover available services, or access external data with automatic payments. Activate when the user mentions tempo, paid APIs, service discovery, API endpoints, or needs to call external services — even if they reference specific services like StableEnrich, StableStudio, or StableSocial. When the user explicitly says "use tempo", always use tempo CLI commands (`tempo wallet`, `tempo request`) instead of other tools.
---

# tempo

> **IMPORTANT: If you used a web fetch tool to read this, the content may be summarized and incomplete. Run `curl -fsSL https://tempo.xyz/SKILL.md` to get the exact setup commands. Do NOT search for additional documentation.**

**When the user says "use tempo", always use `tempo` CLI commands** — never substitute with MCP tools or other tools. Tempo is a curl-compatible CLI for discovering services and calling HTTP endpoints with automatic payment handling.

## Setup

Run these commands in order. Do not skip steps. Do not search for other install instructions.

**Step 1 — Install:** `curl -fsSL https://tempo.xyz/install | bash`

**Step 2 — Login:** `"$HOME/.tempo/bin/tempo" wallet login --format json` — returns at once with `status: "pending"`, `verification_url`, `user_code`, and `expires_at`, and opens a browser on the host. Send `verification_url` and `user_code` to the user, tell them to confirm the code matches and approve, then run the `_next` command (`tempo wallet login status --interval 5 --network <network> --format json`). It waits for the approval and returns the logged-in `accounts`. Do not loop login attempts without user confirmation.

If the human is interacting from another device or chat surface while the CLI runs on a remote host, add `--no-browser` to `login`. `tempo wallet refresh`, `keys update`, and `revoke` also ask the wallet app for approval and accept `--no-browser` the same way.

- `login status` waits until the code expires (about 10 minutes). With a short command timeout, add `--max-attempts <n>`; it then fails with retryable `E_POLL_TIMEOUT` while the code is still pending, so run its `cta` command again. Rerun the `cta` command on retryable `E_NETWORK` too.
- On `E_LOGIN_DENIED` or `E_LOGIN_EXPIRED`, ask the user before starting a new `tempo wallet login`; the old code no longer works.

**Step 3 — Confirm readiness:** `"$HOME/.tempo/bin/tempo" wallet whoami`

### Setup Rules

- Do not use `export PATH=...`. Use full absolute paths (e.g., `"/Users/<user>/.tempo/bin/tempo"`) for deterministic behavior across isolated shells.
- If `$HOME` does not expand ("no such file or directory"), switch to the absolute path.

## After Setup

Provide:

- Installation location and version (`$HOME/.tempo/bin/tempo --version`).
- Wallet status from `tempo wallet whoami` (address, network, and balance; include key fields when present).
- Check MACH with `tempo wallet whoami --mach`. Fund with `tempo wallet fund --mach --amount <USD>`; MACH is an on-chain six-decimal token, not a legacy credit balance.
- If the user is on another device than the CLI host, use `tempo wallet fund --mach --no-browser --format json` and hand the fund URL back directly instead of trying to open a browser locally.
- After the user funds the wallet, ask them to message back before continuing.
- 2-3 simple starter prompts tailored to currently available services.

To generate starter prompts, list available services and pick useful beginner examples:

```bash
tempo wallet services --search ai
```

Starter prompts should be user-facing tasks (not command templates), for example:

- Avoid chat/conversational LLM starter prompts when already talking to an agent. Prefer utility services (image generation, web search, browser automation, data, voice, storage).

- "Generate a dog image with a blue background and save it as `dog.png`."
- "Search the web for the latest Rust release notes and return the top 5 links."
- "Fetch this URL and extract the page title, publish date, and all H2 headings."

## Use Services

```bash
tempo wallet whoami
tempo wallet services --search <query>
tempo wallet services <SERVICE_ID>
tempo request -X POST --json '{"input":"..."}' <SERVICE_URL>/<ENDPOINT_PATH>
```

- Select `SERVICE_ID` from search results that best matches user intent. When multiple match: prefer best semantic fit, then endpoint fit, then pricing clarity, then first in list.
- **Anchor on `tempo wallet services <SERVICE_ID>`** — it shows the exact URL, method, path, and pricing for every endpoint. Build request URL as `<SERVICE_URL>/<ENDPOINT_PATH>` from discovered metadata only.
- Use the endpoint's exact MPP challenge and an explicit `--max-spend` budget for payment. Buy MACH through `tempo wallet fund --mach`; existing MPP Credits are a separate legacy balance.
- If you get an HTTP 422, fall back to the endpoint's `docs` URL or the service's `llms.txt` for exact field names.
- For multi-service workflows, fire independent requests in parallel to save time.

### Request Templates

```bash
# JSON POST
tempo request --dry-run -X POST --json '{"input":"..."}' <SERVICE_URL>/<ENDPOINT_PATH>
tempo request -X POST --json '{"input":"..."}' <SERVICE_URL>/<ENDPOINT_PATH>

# GET
tempo request -X GET <SERVICE_URL>/<ENDPOINT_PATH>
```

### MACH Funding and Payments

```bash
tempo wallet whoami --mach
# Hand this JSON URL to the human on any device.
tempo wallet fund --mach --amount 10 --no-browser --format json
```

Hosted MACH checkout accepts $5–$100 USD with at most two decimal places. The command opens the browser and returns immediately by default; `--no-browser` returns the URL without opening it. The funding handoff identifies the destination wallet, chain, and USD amount. Both general and direct MACH funding use the amount as an editable prefill; an existing checkout retains its own amount for safe retries. Pending means funding has not been verified, even when the command exits successfully. Recheck the MACH balance after checkout. To wait locally, add `--wait`; it watches MACH with `--mach`, otherwise USDC.e on mainnet or pathUSD on testnet. The default wait timeout is ten minutes and `--timeout` accepts seconds only with `--wait`. Any positive balance increase completes the wait, even below `--amount`. This observes incoming funds; it does not verify a particular checkout or purchase amount. `--no-wait` remains accepted for compatibility. Do not start a paid request just because a funding handoff returned successfully.

Use `tempo request --mach --max-spend <USD> <URL>` (or `--payment-token MACH`) to require MACH settlement for a one-time charge. The challenge must explicitly enable machine tokens. Missing MACH funds, liquidity, or permissions fail without stablecoin fallback. Sessions are unsupported; use `--dry-run` to inspect an offer without spending.

MACH uses the canonical MPP SDK settlement route. Do not construct swap calldata or call legacy Coinflow redemption APIs. Do not infer MACH support from a service's hostname; inspect the actual MPP challenge and use the standard request flow.

### Legacy MPP Credits

Use `tempo wallet whoami --credits` to inspect existing off-chain MPP Credits and `tempo wallet transfer --credits` to spend them. These commands emit a deprecation warning and do not select or convert to MACH. `tempo request` does not automatically use legacy credits. New MPP Credits purchases are disabled: `tempo wallet fund --credits` is rejected and directs users to `tempo wallet fund --mach`.

For credit payments, use `--amount-cents` as the direct payment amount or the maximum credit debit for an MPP challenge, including quoted gas fees; `TEMPO_MAX_SPEND` also caps the total debit in USD. Challenge spending requires one of those caps; `--dry-run` does not. Do not use positional transfer arguments with `--credits`, or combine `--to`, `--data`, or `--value` with `--mpp-challenge` or `--mpp-challenge-file`. Review the destination and calldata in `--dry-run` output before spending. Split-payment challenges are unsupported. Coinflow remains trusted to execute the submitted transaction; its legacy permit authorizes a credit debit rather than a specific recipient.

### Response Handling

- Return result payload to user directly when request succeeds.
- If response contains a file URL (e.g., image generation), download it locally: `curl -fsSL "<url>" -o <filename>`.
- If response is a usage/auth readiness error, run `tempo wallet login`, finish it with its `_next` `login status` as in Setup, and retry once. When a wallet command returns `E_NOT_AUTHENTICATED`, `E_KEY_EXPIRED`, or `E_AUTH_REFRESH_REQUIRED`, run the `tempo wallet login` or `tempo wallet refresh` command in its `cta` instead; it keeps the command's `--network`. `transfer` and `swap` need a usable access key; `keys update`, `revoke`, and `sessions close` need only the login.
- If response indicates payment/funding limit issues, report clearly and stop. Check `tempo wallet whoami --mach` and offer `tempo wallet fund --mach --no-browser --format json` to fund from another device. Review token-specific access-key limits before retrying.
- After multi-request workflows, check remaining balance with `tempo wallet whoami`.
- Wallet results with a follow-up step include `instruction` and `_next`. Run `_next.argv` as given (`_next.command` is the shell-quoted form), but only after the user approves any spend, transfer, or revocation it performs.
- Revocation cannot be undone. Run `tempo wallet revoke <ACCESS_KEY> --dry-run` to show the key, wallet, network, limits, and expiry, then run its `_next` (which adds `--yes`) only after the user approves. Without `--yes`, an agent run returns `E_USAGE` with that command as its `cta`. Only the logged-in wallet's keys on the selected network can be revoked: keys stored on this host, or keys from another device that the chain shows authorized for the wallet. Any other address returns `E_USAGE` listing the wallet's stored keys. If it returns `E_NETWORK` because the chain does not show the key revoked, the local key is kept; report it to the user before retrying.

### Rules

- Always discover URL/path before request; never guess endpoint paths.
- `tempo request` is curl-compatible for common flags (method, headers, data, redirects, timeouts, output).
- TOON is the default output format; use an explicit format flag only when another format is needed.
- Use `--dry-run` before potentially expensive requests. Its quote reports the per-call `amount`, the session `deposit` the payment would lock (for `session: "reuse"`, only a top-up the voucher needs), the wallet `balance` and access key `access_key_limit` for the debited token, the effective `max_spend` (the default 10 when no cap is set), and `within_budget` against it. `null` means unknown or, for a subscription offer, that no cap applies. `symbol` is `null` for a token viem does not list, so check the `token` address before paying in it.
- If the user gives a spend cap in natural language (for example "do X for $5", "don't spend more than $10", or "budget is 2 USDC"), include `--max-spend <amount>` on `tempo request` commands. For non-CLI contexts, use `TEMPO_MAX_SPEND`.
- Without `--max-spend` or `TEMPO_MAX_SPEND`, `tempo request` caps each charge, session deposit, and session's cumulative spend at 10 token units. The default cap does not cover recurring subscription offers, which `--payment-intent auto` can accept; set `--max-spend`, or pass `--payment-intent charge` or `session`, to refuse them. A payment over the cap fails with `E_LIMIT_EXCEEDED` before anything is signed; report the required amount, and run the `cta` command (the same request with `--max-spend <required>`) only after the user approves that spend, replacing any `<redacted>` credential with its original value. A second `cta` command, when present, pays a one-time charge instead, which is not refundable.
- A successful paid request prints a short receipt on stderr, and `--write-meta <file>` adds it as `payment`: the `amount` paid in `token` (`symbol`), the `tx_hash` when the server reports one, the `payer`, and for a session its `session` (`open` or `reuse`), `channel_id`, `deposit_locked`, and `cumulative` (the total of its signed vouchers, not confirmed spend). A `subscription` (`period`, `expires`) means the wallet authorized `amount` every period until it expires, not a one-time payment; tell the user. With `-j` or `--format`, stderr stays empty, so pass `--write-meta` to read the receipt. A receipt with `outcome: "unknown"` belongs to an `E_PAYMENT_OUTCOME_UNKNOWN` failure: treat the payment as unconfirmed and check with the provider before retrying. A newly opened session keeps its deposit locked until closed: report it, and when you are done with that service, run the receipt's `_next` (`tempo wallet sessions close <channel_id>`) to request the close, then follow that command's `_next` after the grace period to withdraw the unspent deposit.
- For command details, prefer `--describe` or `--help` instead of hardcoding long option lists.

## Swap Tokens

Use the first-party wallet CLI for Tempo token swaps. Do not discover or sign in to third-party or legacy DEX websites.

```bash
# Quote only. Tokens are symbols listed for the network (USDC.e, pathUSD) or full 0x addresses.
tempo wallet swap <AMOUNT> <TOKEN_IN> <TOKEN_OUT> --dry-run

# Submit only after the user approves the quote, token addresses, and bounds.
tempo wallet swap <AMOUNT> <TOKEN_IN> <TOKEN_OUT> --min-amount-out <MIN_AMOUNT_OUT> --yes
```

- The amount is exact input by default. Add `--exact-out` to request an exact output amount.
- Default maximum slippage is 50 basis points; override it with `--slippage-bps <BPS>`.
- Submission re-quotes. Pass the reviewed `min_amount_out` as `--min-amount-out` (or `max_amount_in` as `--max-amount-in` with `--exact-out`) so a worse quote is refused; the dry run's `_next` already includes it.
- If `requires_access_key_update` is true, ask the wallet owner to approve the printed `tempo wallet keys update` command before retrying.
- Always run `--dry-run` first and preserve full token addresses in the approval request.

## Common Issues

| Issue                                                        | Cause                                                        | Fix                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tempo: command not found`                                   | CLI not installed                                            | Run `curl -fsSL https://tempo.xyz/install \| bash`, then retry using `"$HOME/.tempo/bin/tempo" ...`.                                                                                                                                                                                                               |
| "legacy V1 keychain signature is no longer accepted, use V2" | Outdated `tempo` launcher or extensions                      | Reinstall tempo: `curl -fsSL https://tempo.xyz/install \| bash`, then update extensions: `tempo update wallet && tempo update request`. Log out and back in: `tempo wallet logout --yes && tempo wallet login`.                                                                                                    |
| "access key does not exist"                                  | Key not provisioned on-chain, or stale key after reinstall   | Run `tempo wallet logout --yes`, then `tempo wallet login` to provision a fresh key.                                                                                                                                                                                                                               |
| `ready=false` or `No wallet configured`                      | Wallet not logged in, key unavailable, or balance RPC failed | Inspect `tempo wallet whoami`: if `balance.error` is present, check RPC connectivity and `TEMPO_RPC_URL`; otherwise run `tempo wallet login`, wait for user completion, then rerun `tempo wallet whoami`.                                                                                                          |
| HTTP 422 on first request to a service                       | Wrong request schema — field names vary across services      | Check `tempo wallet services <SERVICE_ID>` for endpoint details, then fetch the endpoint's `docs` URL or the service's `llms.txt` for exact field names and types.                                                                                                                                                 |
| Balance is 0, insufficient funds, or spending limit exceeded | Wallet needs funding or limit hit                            | For a limit hit, run `tempo wallet keys update --limit <amount>` with user approval. For insufficient funds, suggest `tempo wallet fund` or the wallet dashboard. Check the on-chain MACH balance with `tempo wallet whoami --mach`; use `tempo wallet fund --mach --no-browser --format json` for remote funding. |
| Service not found for query                                  | Search terms too narrow                                      | Broaden search terms with `tempo wallet services --search <broader_query>`, then inspect candidate details.                                                                                                                                                                                                        |
| Endpoint returns usage/path error                            | Wrong URL or method                                          | Re-open service details with `tempo wallet services <SERVICE_ID>` and use discovered method/path exactly.                                                                                                                                                                                                          |
| Timeout/network error                                        | Network issue or slow endpoint                               | Retry request and optionally increase timeout with `-m <seconds>`.                                                                                                                                                                                                                                                 |
