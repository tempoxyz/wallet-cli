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

**Step 2 — Login:** `"$HOME/.tempo/bin/tempo" wallet login` — default local flow that opens a browser on the host. Prompt user, wait for confirmation, then continue. Do not loop login attempts without user confirmation. When run by agents, use a long command timeout (at least 16 minutes).

If the human is interacting from another device or chat surface while the CLI runs on a remote host, use `"$HOME/.tempo/bin/tempo" wallet login --no-browser` instead. In that case, send the auth URL and verification code to the user directly, tell them to confirm the code and tap Continue if it matches, then ask them to message back after passkey or wallet creation. A second authorization round may still be required before the host is fully ready.

**Step 3 — Confirm readiness:** `"$HOME/.tempo/bin/tempo" wallet whoami`

### Setup Rules

- Do not use `export PATH=...`. Use full absolute paths (e.g., `"/Users/<user>/.tempo/bin/tempo"`) for deterministic behavior across isolated shells.
- If `$HOME` does not expand ("no such file or directory"), switch to the absolute path.

## After Setup

Provide:

- Installation location and version (`$HOME/.tempo/bin/tempo --version`).
- Wallet status from `tempo wallet whoami` (address and balance; include key/network fields when present).
- Check MACH with `tempo wallet whoami --mach`. Fund with `tempo wallet fund --mach --amount <USD>`; MACH is an on-chain six-decimal token, not a legacy credit balance.
- If the user is on another device than the CLI host, use `tempo wallet fund --mach --no-browser --no-wait --format json` and hand the fund URL back directly instead of trying to open a browser locally.
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
- Use the endpoint's exact MPP challenge and an explicit `--max-spend` budget for payment. MACH funding is available through `tempo wallet fund --mach`; legacy `--credits` flags are aliases for MACH.
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
tempo wallet fund --mach --amount 10 --no-browser --no-wait --format json
```

Hosted MACH checkout accepts $5–$100 USD with at most two decimal places. The funding handoff identifies the exact destination wallet, chain, and requested USD amount. Pending means the checkout has not been verified. Recheck the MACH balance after checkout. To wait locally, omit `--no-wait`; the default timeout is ten minutes and `--timeout` accepts seconds. Never interpret a small unrelated deposit as fulfillment of the requested funding amount.

Use `tempo request --mach --max-spend <USD> <URL>` (or `--payment-token MACH`) to require MACH settlement for a one-time charge. The challenge must explicitly enable machine tokens. Missing MACH funds, liquidity, or permissions fail without stablecoin fallback. Sessions are unsupported; use `--dry-run` to inspect an offer without spending. Legacy `--credits` aliases select MACH and do not convert or redeem old Coinflow credits.

MACH uses the canonical MPP SDK settlement route. Do not construct swap calldata or call legacy Coinflow redemption APIs. Do not infer MACH support from a service's hostname; inspect the actual MPP challenge and use the standard request flow.

### Response Handling

- Return result payload to user directly when request succeeds.
- If response contains a file URL (e.g., image generation), download it locally: `curl -fsSL "<url>" -o <filename>`.
- If response is a usage/auth readiness error, run `tempo wallet login` and retry once.
- If response indicates payment/funding limit issues, report clearly and stop. Check `tempo wallet whoami --mach` and offer `tempo wallet fund --mach --no-browser --no-wait --format json` to fund from another device. Review token-specific access-key limits before retrying.
- After multi-request workflows, check remaining balance with `tempo wallet whoami`.

### Rules

- Always discover URL/path before request; never guess endpoint paths.
- `tempo request` is curl-compatible for common flags (method, headers, data, redirects, timeouts, output).
- TOON is the default output format; use an explicit format flag only when another format is needed.
- Use `--dry-run` before potentially expensive requests.
- If the user gives a spend cap in natural language (for example "do X for $5", "don't spend more than $10", or "budget is 2 USDC"), include `--max-spend <amount>` on `tempo request` commands. For non-CLI contexts, use `TEMPO_MAX_SPEND`.
- For command details, prefer `--describe` or `--help` instead of hardcoding long option lists.

## Swap Tokens

Use the first-party wallet CLI for Tempo token swaps. Do not discover or sign in to third-party or legacy DEX websites.

```bash
# Quote only. Use full token addresses from `tempo wallet whoami`.
tempo wallet swap <AMOUNT> <TOKEN_IN> <TOKEN_OUT> --dry-run

# Submit only after the user approves the quote, token addresses, and bounds.
tempo wallet swap <AMOUNT> <TOKEN_IN> <TOKEN_OUT> --yes
```

- The amount is exact input by default. Add `--exact-out` to request an exact output amount.
- Default maximum slippage is 50 basis points; override it with `--slippage-bps <BPS>`.
- If `requires_access_key_update` is true, ask the wallet owner to approve the printed `tempo wallet keys update` command before retrying.
- Always run `--dry-run` first and preserve full token addresses in the approval request.

## Common Issues

| Issue                                                        | Cause                                                        | Fix                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tempo: command not found`                                   | CLI not installed                                            | Run `curl -fsSL https://tempo.xyz/install \| bash`, then retry using `"$HOME/.tempo/bin/tempo" ...`.                                                                                                                                                                                                                         |
| "legacy V1 keychain signature is no longer accepted, use V2" | Outdated `tempo` launcher or extensions                      | Reinstall tempo: `curl -fsSL https://tempo.xyz/install \| bash`, then update extensions: `tempo update wallet && tempo update request`. Log out and back in: `tempo wallet logout --yes && tempo wallet login`.                                                                                                              |
| "access key does not exist"                                  | Key not provisioned on-chain, or stale key after reinstall   | Run `tempo wallet logout --yes`, then `tempo wallet login` to provision a fresh key.                                                                                                                                                                                                                                         |
| `ready=false` or `No wallet configured`                      | Wallet not logged in, key unavailable, or balance RPC failed | Inspect `tempo wallet whoami`: if `balance.error` is present, check RPC connectivity and `TEMPO_RPC_URL`; otherwise run `tempo wallet login`, wait for user completion, then rerun `tempo wallet whoami`.                                                                                                                    |
| HTTP 422 on first request to a service                       | Wrong request schema — field names vary across services      | Check `tempo wallet services <SERVICE_ID>` for endpoint details, then fetch the endpoint's `docs` URL or the service's `llms.txt` for exact field names and types.                                                                                                                                                           |
| Balance is 0, insufficient funds, or spending limit exceeded | Wallet needs funding or limit hit                            | For a limit hit, run `tempo wallet keys update --limit <amount>` with user approval. For insufficient funds, suggest `tempo wallet fund` or the wallet dashboard. Check the on-chain MACH balance with `tempo wallet whoami --mach`; use `tempo wallet fund --mach --no-browser --no-wait --format json` for remote funding. |
| Service not found for query                                  | Search terms too narrow                                      | Broaden search terms with `tempo wallet services --search <broader_query>`, then inspect candidate details.                                                                                                                                                                                                                  |
| Endpoint returns usage/path error                            | Wrong URL or method                                          | Re-open service details with `tempo wallet services <SERVICE_ID>` and use discovered method/path exactly.                                                                                                                                                                                                                    |
| Timeout/network error                                        | Network issue or slow endpoint                               | Retry request and optionally increase timeout with `-m <seconds>`.                                                                                                                                                                                                                                                           |
