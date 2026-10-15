import { z } from "incur";

import { supportedShells } from "./completions.js";

/** CLI-level options incur parses anywhere in argv; commands and middleware read `c.globals`. */
export const cliGlobals = z.object({
  network: z
    .string()
    .optional()
    .describe(
      "Network to use: mainnet or testnet (default: TEMPO_WALLET_NETWORK, then the logged-in wallet's network)",
    ),
});

export const cliGlobalAlias = { network: "n" };

export const globalOptionShape = {
  verbose: z.boolean().optional().describe("Increase verbosity"),
  silent: z.boolean().optional().describe("Silent mode: suppress non-essential output"),
  "json-output": z.boolean().optional().describe("Quick switch for JSON output format"),
  "toon-output": z.boolean().optional().describe("Quick switch for TOON output format"),
};

export const globalAlias = {
  verbose: "v",
  silent: "s",
  "json-output": "j",
  "toon-output": "t",
};

/** Wallet-app flows open a browser unless `--no-browser` asks them to print the URL and code. */
const browserOption = z
  .boolean()
  .default(true)
  .describe("Open a browser; use --no-browser to disable");

/** Matches `networkFields`: the chain a command ran against and its network label. */
const networkOutputShape = {
  chain_id: z.number(),
  network: z.string(),
};

/** Continuation fields on results with a follow-up command; built by `nextStep`. */
const nextOutputShape = {
  instruction: z.string().optional().describe("What to do next"),
  _next: z
    .object({
      argv: z.array(z.string()).describe("Next command as an argument vector; authoritative"),
      command: z.string().describe("argv quoted for a POSIX shell"),
      until: z
        .string()
        .optional()
        .describe("jq condition on the next command's JSON output; rerun it until true"),
      poll_interval_seconds: z
        .number()
        .optional()
        .describe("Seconds to wait before running the next command, and between reruns"),
    })
    .optional(),
};

export const completionsOutput = z.object({
  supported_shells: z.array(z.string()),
});

export const creditsOutput = z.object({
  credits: z
    .object({
      wallet: z.string(),
      balance: z.string(),
      rawBalance: z.string(),
    })
    .nullable(),
});

export const machOutput = z.object({
  mach: z.object({
    wallet: z.string(),
    ...networkOutputShape,
    token: z.string(),
    symbol: z.literal("MACH"),
    decimals: z.number(),
    balance: z.string(),
    raw_balance: z.string(),
  }),
});

export const whoamiOutput = z.union([
  z.object({ ready: z.boolean() }),
  z.object({
    ready: z.boolean(),
    wallet: z.string().nullable(),
    ...networkOutputShape,
    balance: z.object({
      total: z.string().nullable(),
      locked: z.string(),
      pending_refund: z.string(),
      available: z.string().nullable(),
      active_sessions: z.number(),
      symbol: z.string().nullable(),
      error: z.object({ code: z.literal("E_RPC"), message: z.string() }).optional(),
    }),
    balances: z.array(
      z.object({
        token: z.string(),
        symbol: z.string().nullable(),
        decimals: z.number(),
        balance: z.string(),
        verified: z.boolean(),
        access_key_limit: z.string().nullable(),
      }),
    ),
    key: z
      .object({
        address: z.string(),
        ...networkOutputShape,
        symbol: z.string().nullable(),
        token: z.string(),
        balance: z.string().nullable(),
        balance_error: z.object({ code: z.literal("E_RPC"), message: z.string() }).optional(),
        spending_limit: z.object({
          mode: z.enum(["unknown", "unrestricted", "none", "restricted"]),
          unlimited: z.boolean().nullable(),
          limit: z.string().nullable(),
          raw_limit: z.string().nullable(),
          period_seconds: z.number().nullable(),
          remaining: z.string().nullable(),
          spent: z.string().nullable(),
        }),
        spending_limits: z.array(
          z.object({
            unlimited: z.boolean(),
            symbol: z.string().nullable(),
            token: z.string(),
            limit: z.string().nullable(),
            raw_limit: z.string(),
            period_seconds: z.number().nullable(),
            remaining: z.string().nullable(),
            spent: z.string().nullable(),
          }),
        ),
        call_permissions: z.enum(["unknown", "unrestricted", "none", "restricted"]),
        scopes: z.array(
          z.object({
            address: z.string(),
            selector: z.string().nullable(),
            recipients: z.array(z.string()),
          }),
        ),
        status: z.string().nullable(),
        expires_at: z.string().nullable(),
      })
      .nullable(),
  }),
  machOutput,
  creditsOutput,
]);

/** One access key as `keys list` reports it. */
const accessKeyOutput = z.object({
  address: z.string(),
  ...networkOutputShape,
  wallet_address: z.string(),
  symbol: z.string().nullable(),
  token: z.string(),
  balance: z.string().nullable(),
  balance_error: z.object({ code: z.literal("E_RPC"), message: z.string() }).optional(),
  spending_limit: z.object({
    mode: z.enum(["unknown", "unrestricted", "none", "restricted"]),
    unlimited: z.boolean().nullable(),
    limit: z.string().nullable(),
    raw_limit: z.string().nullable(),
    period_seconds: z.number().nullable(),
    remaining: z.string().nullable(),
    spent: z.string().nullable(),
  }),
  spending_limits: z.array(
    z.object({
      unlimited: z.boolean(),
      symbol: z.string().nullable(),
      token: z.string(),
      limit: z.string().nullable(),
      raw_limit: z.string(),
      period_seconds: z.number().nullable(),
      remaining: z.string().nullable(),
      spent: z.string().nullable(),
    }),
  ),
  call_permissions: z.enum(["unknown", "unrestricted", "none", "restricted"]),
  scopes: z.array(
    z.object({
      address: z.string(),
      selector: z.string().nullable(),
      recipients: z.array(z.string()),
    }),
  ),
  status: z.string().nullable(),
  expires_at: z.string().nullable(),
});

export const keysOutput = z.object({
  keys: z.array(accessKeyOutput),
  total: z.number(),
});

export const revokeArgs = z.object({
  accessKey: z.string().describe("Access key address to revoke (0x...)"),
});

export const revokeOptions = z.object({
  ...globalOptionShape,
  "dry-run": z
    .boolean()
    .optional()
    .describe("Show the key that would be revoked without revoking it"),
  yes: z.boolean().optional().describe("Revoke without a confirmation prompt"),
  browser: browserOption,
});

const revokeOutputShape = {
  wallet: z.string(),
  access_key: z.string(),
  ...networkOutputShape,
  local_key_removed: z.boolean(),
};

export const revokeOutput = z.union([
  z.object({
    status: z.literal("dry_run"),
    ...revokeOutputShape,
    key: accessKeyOutput,
    ...nextOutputShape,
  }),
  z.object({ status: z.literal("success"), ...revokeOutputShape }),
]);

export const updateAccessKeyOutput = z.object({
  status: z.literal("success"),
  wallet: z.string(),
  access_key: z.string(),
  ...networkOutputShape,
  token: z.string(),
  limit: z.string(),
  ...nextOutputShape,
});

export const updateAccessKeyOptions = z.object({
  ...globalOptionShape,
  limit: z.string().describe("New remaining limit in human token units"),
  token: z
    .string()
    .optional()
    .describe("Token address or symbol (e.g. USDC.e); defaults to the current limit token"),
  browser: browserOption,
});

export const updateAccessKeyArgs = z.object({
  accessKey: z
    .string()
    .optional()
    .describe("Access key address; defaults to the only key for this wallet and network"),
});

export const transferDryRunOutput = z.object({
  status: z.literal("dry_run"),
  ...networkOutputShape,
  amount: z.string(),
  symbol: z.string().nullable(),
  token: z.string(),
  to: z.string(),
  from: z.string(),
  ...nextOutputShape,
});

export const transferSuccessOutput = z.object({
  status: z.literal("success"),
  tx_hash: z.string(),
  ...networkOutputShape,
  amount: z.string(),
  symbol: z.string().nullable(),
  token: z.string(),
  to: z.string(),
  from: z.string(),
});

export const spendCreditsOutput = z.object({
  wallet: z.string(),
  amount_cents: z.number(),
  ...networkOutputShape,
  to: z.string(),
  token: z.string().optional(),
  challenge_id: z.string().optional(),
  transaction_data: z.union([
    z.object({ type: z.literal("token"), destination: z.string() }),
    z.object({ transaction: z.object({ to: z.string(), data: z.string() }) }),
  ]),
  tx_hash: z.string().optional(),
  dry_run: z.boolean().optional(),
});

export const spendMachOutput = z.object({
  wallet: z.string().optional(),
  amount: z.string(),
  amount_raw: z.string(),
  token: z.literal("MACH"),
  settlement_currency: z.string(),
  ...networkOutputShape,
  challenge_id: z.string(),
  max_spend: z.string().nullable(),
  tx_hash: z.string().optional(),
  dry_run: z.boolean().optional(),
  ...nextOutputShape,
});

export const sessionOutput = z.object({
  channel_id: z.string(),
  network: z.string(),
  origin: z.string(),
  symbol: z.string().nullable(),
  deposit: z.string(),
  spent: z.string(),
  remaining: z.string(),
  status: z.string(),
  remaining_secs: z.number().optional(),
  created_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
});

export const sessionsListOutput = z.object({
  ...networkOutputShape,
  sessions: z.array(sessionOutput),
  total: z.number(),
});

export const sessionsCloseDryRunOutput = z.object({
  targets: z.array(z.unknown()),
});

export const sessionsCloseOutput = z.object({
  closed: z.number(),
  pending: z.number(),
  failed: z.number(),
  results: z.array(z.unknown()),
  ...nextOutputShape,
});

export const serviceOutput = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  service_url: z.string().optional(),
  description: z.string().optional(),
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  endpoint_count: z.number().optional(),
});

export const serviceDetailOutput = serviceOutput.extend({
  docs: z.unknown().optional(),
  endpoints: z.array(z.unknown()).optional(),
  stale: z.boolean().optional(),
  fetched_at: z.string().optional(),
});

export const doctorOutput = z.object({
  ...networkOutputShape,
  versions: z.object({
    wallet_cli: z.string(),
    node: z.string(),
    platform: z.string(),
    arch: z.string(),
    incur: z.string().nullable(),
    accounts: z.string().nullable(),
  }),
  wallet: z.object({
    logged_in: z.boolean(),
    address: z.string().nullable(),
    type: z
      .enum(["passkey", "private_key", "device_code"])
      .nullable()
      .describe("What signs for the account, from the key type the wallet store records"),
    chain_id: z.number().nullable().describe("The wallet store's chain"),
    network: z.string().nullable(),
    private_key_env: z
      .boolean()
      .describe("Whether TEMPO_PRIVATE_KEY is set; its value is never shown"),
  }),
  key: z.object({
    address: z.string().nullable(),
    status: z.enum(["ready", "pending", "expired", "unusable", "missing"]),
    expires_at: z.string().nullable(),
    spending_limits: accessKeyOutput.shape.spending_limits,
  }),
  rpc: z.object({
    url: z.string().describe("RPC URL with credentials, path, and query redacted"),
    ok: z.boolean().describe("Whether the RPC answered eth_chainId"),
    chain_id: z.number().nullable(),
    chain_matches: z.boolean().nullable(),
    latency_ms: z.number().nullable(),
  }),
  auth: z.object({ url: z.string().describe("Wallet app URL, redacted like rpc.url") }),
  sqlite3: z.object({ found: z.boolean(), version: z.string().nullable() }),
  session_store: z.object({ path: z.string(), exists: z.boolean(), readable: z.boolean() }),
  env: z
    .array(z.object({ name: z.string(), value: z.string().nullable() }))
    .describe("Overrides that are set; value is null for a secret and redacted for a URL"),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["ok", "warn", "fail"]),
      message: z.string(),
    }),
  ),
  ...nextOutputShape,
});

export const logoutOutput = z.object({
  logged_in: z.boolean(),
  disconnected: z.boolean(),
  wallet: z.string().nullable(),
  message: z.string(),
});

export const fundOutput = z.object({
  status: z.enum(["success", "pending"]),
  wallet: z.string().nullable(),
  action: z.string(),
  url: z.string(),
  ...networkOutputShape,
  token: z.string(),
  symbol: z.string().optional(),
  amount: z.string().nullable(),
  balance: z.string().nullable(),
  raw_balance: z.string().nullable(),
});

export const loginOptions = z.object({
  ...globalOptionShape,
  browser: browserOption,
  wait: z
    .boolean()
    .optional()
    .describe(
      "Wait for approval (default in a terminal); --no-wait returns the code for 'login status'",
    ),
});

export const loginStatusOptions = z.object({
  ...globalOptionShape,
  interval: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Seconds between checks (default: the wallet's interval)"),
  "max-attempts": z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Checks before giving up with E_POLL_TIMEOUT (default: until the code expires)"),
});

export const globalOptions = z.object(globalOptionShape);

export const loginStatusOutput = z.object({
  accounts: z.array(z.string()),
  chainId: z.number(),
  ...nextOutputShape,
});

export const loginOutput = z.union([
  whoamiOutput,
  loginStatusOutput,
  z.object({
    status: z.literal("pending"),
    verification_url: z.string().describe("URL where the user approves the login"),
    user_code: z.string().describe("Code the user checks against the one the wallet shows"),
    expires_at: z.string().describe("When the code expires (ISO 8601)"),
    ...nextOutputShape,
  }),
]);

export const refreshOptions = z.object({
  ...globalOptionShape,
  browser: browserOption,
});

export const refreshOutput = z.object({
  accounts: z.array(z.string()),
  chainId: z.number(),
});

export const logoutOptions = z.object({
  ...globalOptionShape,
  yes: z.boolean().optional().describe("Skip confirmation prompt"),
});

export const whoamiOptions = z.object({
  ...globalOptionShape,
  mach: z.boolean().optional().describe("Show on-chain MACH balance"),
  credits: z.boolean().optional().describe("Show existing MPP Credits balance (deprecated)"),
});

export const transferArgs = z.object({
  amount: z.string().optional().describe('Amount in human units ("1.00", "50")'),
  token: z.string().optional().describe("Token address (0x...) or symbol (e.g. USDC.e)"),
  to: z.string().optional().describe("Recipient address (0x...)"),
});

export const transferOptions = z.object({
  ...globalOptionShape,
  "fee-token": z.string().optional().describe("Pay fees in a different token (address or symbol)"),
  "dry-run": z.boolean().optional().describe("Show plan + fee estimate, don't send"),
  mach: z.boolean().optional().describe("Pay with on-chain MACH"),
  credits: z.boolean().optional().describe("Spend existing MPP Credits (deprecated)"),
  "max-spend": z
    .string()
    .optional()
    .describe("Maximum MACH spend in USD for the exact MPP challenge"),
  "amount-cents": z.coerce
    .number()
    .optional()
    .describe("Credits amount or MPP challenge spending cap in USD cents"),
  to: z.string().optional().describe("Credits recipient; unsupported with MACH"),
  data: z.string().optional().describe("Credits calldata; unsupported with MACH"),
  value: z.string().optional().describe("Credits ETH value (must be zero); unsupported with MACH"),
  "mpp-challenge": z.string().optional().describe("MPP WWW-Authenticate challenge"),
  "mpp-challenge-file": z.string().optional().describe("File containing an MPP challenge"),
  "mpp-client-id": z.string().optional().describe("Optional client ID for MPP attribution memo"),
  address: z.string().optional().describe("Wallet address (defaults to current wallet)"),
});

export const transferOutput = z.union([
  transferDryRunOutput,
  transferSuccessOutput,
  spendMachOutput,
  spendCreditsOutput,
]);

export const swapArgs = z.object({
  amount: z
    .string()
    .describe("Exact input amount by default; exact output amount with --exact-out"),
  tokenIn: z.string().describe("Input token address (0x...) or symbol (e.g. USDC.e)"),
  tokenOut: z.string().describe("Output token address (0x...) or symbol (e.g. pathUSD)"),
});

export const swapOptions = z.object({
  ...globalOptionShape,
  "exact-out": z.boolean().optional().describe("Treat amount as the exact output amount"),
  "slippage-bps": z.coerce.number().default(50).describe("Maximum slippage in basis points"),
  "min-amount-out": z
    .string()
    .optional()
    .describe("Exact input: refuse to receive less than this reviewed tokenOut amount"),
  "max-amount-in": z
    .string()
    .optional()
    .describe("Exact output: refuse to spend more than this reviewed tokenIn amount"),
  "fee-token": z
    .string()
    .optional()
    .describe("Token address or symbol used to pay fees; defaults to tokenIn"),
  "dry-run": z.boolean().optional().describe("Quote and show calls without submitting"),
  yes: z.boolean().optional().describe("Confirm the reviewed swap for submission"),
});

const swapBaseOutputShape = {
  ...networkOutputShape,
  mode: z.union([z.literal("exact_in"), z.literal("exact_out")]),
  from: z.string(),
  dex: z.string(),
  token_in: z.string(),
  token_in_symbol: z.string().nullable(),
  token_out: z.string(),
  token_out_symbol: z.string().nullable(),
  amount_in: z.string(),
  max_amount_in: z.string(),
  amount_out: z.string(),
  min_amount_out: z.string(),
  slippage_bps: z.number(),
  fee_token: z.string(),
  access_key_limit: z.string().nullable(),
  requires_access_key_update: z.boolean(),
  calls: z.array(z.object({ to: z.string(), data: z.string() })),
};

export const swapOutput = z.union([
  z.object({ status: z.literal("dry_run"), ...swapBaseOutputShape, ...nextOutputShape }),
  z.object({ status: z.literal("success"), tx_hash: z.string(), ...swapBaseOutputShape }),
]);

export const fundOptions = z.object({
  ...globalOptionShape,
  address: z.string().optional().describe("Wallet address to fund (defaults to current wallet)"),
  browser: browserOption,
  crypto: z.boolean().optional().describe("Open the direct crypto funding flow"),
  mach: z.boolean().optional().describe("Open the MACH funding flow"),
  credits: z.boolean().optional().describe("Unavailable; use --mach to buy MACH"),
  amount: z
    .string()
    .optional()
    .describe("USD amount to prefill; MACH: 5–100, up to 2 decimal places"),
  wait: z
    .boolean()
    .default(false)
    .describe("Wait for a balance increase; otherwise return immediately"),
  timeout: z.coerce.number().optional().describe("Timeout in seconds with --wait (default: 600)"),
  "referral-code": z.string().optional().describe("Open referral-code redeem flow"),
  claim: z.string().optional().describe("Alias for --referral-code"),
});

export const sessionsListOptions = z.object({
  ...globalOptionShape,
  orphaned: z.boolean().optional().describe("Include on-chain orphaned discovery"),
  all: z.boolean().optional().describe("Include local sessions and orphaned discovery"),
});

export const sessionsCloseArgs = z.object({
  url: z.string().optional().describe("URL, origin, or channel ID (0x...) to close"),
});

export const sessionsCloseOptions = z.object({
  ...globalOptionShape,
  all: z.boolean().optional().describe("Close all active sessions and on-chain channels"),
  orphaned: z.boolean().optional().describe("Close only orphaned on-chain channels"),
  finalize: z.boolean().optional().describe("Withdraw channels whose close grace period has ended"),
  cooperative: z
    .boolean()
    .optional()
    .describe("Close now through the session's server instead of waiting out the grace period"),
  "dry-run": z.boolean().optional().describe("Show what would be closed without executing"),
});

export const sessionsCloseCommandOutput = z.union([sessionsCloseDryRunOutput, sessionsCloseOutput]);

export const sessionsSyncOptions = z.object({
  ...globalOptionShape,
  origin: z.string().optional().describe("Re-sync a specific origin's close state from on-chain"),
});

export const servicesArgs = z.object({
  serviceId: z.string().optional().describe("Service ID to show details for"),
});

export const servicesOptions = z.object({
  ...globalOptionShape,
  search: z
    .string()
    .optional()
    .describe("Search by name, id, description, tags, or category; every word must match"),
  refresh: z
    .boolean()
    .optional()
    .describe("Fetch the service directory instead of using the cached copy"),
});

export const servicesOutput = z.union([z.array(serviceOutput), serviceDetailOutput]);

export const servicesListOutput = z.array(serviceOutput);

export const servicesMcpOutput = z
  .object({
    ...serviceDetailOutput.partial().shape,
    services: z.array(serviceOutput).optional(),
  })
  .refine(
    (value) => value.services !== undefined || (value.id !== undefined && value.name !== undefined),
    "Expected a services list or service details",
  );

export const completionsArgs = z.object({
  shell: z.enum(supportedShells).optional(),
});

/** `tempo request --dry-run`: a quote for a 402, else the status of a probe that needed no payment. */
export const requestDryRunOutput = z.union([
  z.object({
    payment_required: z.literal(true),
    method: z.string(),
    intent: z.string(),
    recurring: z.boolean(),
    amount: z.string().describe("Per-call amount"),
    amount_raw: z.string(),
    session: z
      .enum(["open", "reuse"])
      .nullable()
      .describe("Whether a session payment opens a channel or reuses a stored one"),
    deposit: z
      .string()
      .nullable()
      .describe(
        "Deposit the payment locks: a new session's deposit, or the top-up a reused session's voucher needs",
      ),
    deposit_raw: z.string().nullable(),
    token: z.string(),
    symbol: z.string().nullable().describe("Listed symbol; null for a token viem does not list"),
    decimals: z.number().nullable(),
    balance: z.string().nullable().describe("Payer's balance of the token the payment debits"),
    access_key_limit: z
      .string()
      .nullable()
      .describe(
        "Active access key's stored limit for the token the payment debits; 0 when exact stored limits leave it out",
      ),
    machine_token_enabled: z.boolean(),
    payment_token: z.string().nullable(),
    chain_id: z.number(),
    max_spend: z
      .string()
      .nullable()
      .describe(
        "Spending cap the payment applies: --max-spend, TEMPO_MAX_SPEND, or the default; null for a subscription",
      ),
    within_budget: z
      .boolean()
      .nullable()
      .describe(
        "Whether the spend fits max_spend; null for a subscription, or when a session's payer or plan is unknown",
      ),
    signer: z.object({
      address: z.string().nullable(),
      source: z.enum(["flag", "env", "wallet"]),
    }),
  }),
  z.object({
    payment_required: z.literal(false),
    status: z.number(),
    probe_sent: z.literal(true),
    warning: z.string().optional(),
  }),
]);
