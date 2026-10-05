import { z } from "incur";

export const globalOptionShape = {
  network: z.string().optional().describe('Network to use (e.g. "testnet")'),
  verbose: z.boolean().optional().describe("Increase verbosity"),
  silent: z.boolean().optional().describe("Silent mode: suppress non-essential output"),
  "json-output": z.boolean().optional().describe("Quick switch for JSON output format"),
  "toon-output": z.boolean().optional().describe("Quick switch for TOON output format"),
};

export const globalAlias = {
  network: "n",
  verbose: "v",
  silent: "s",
  "json-output": "j",
  "toon-output": "t",
};

export const completionsOutput = z.object({
  supported_shells: z.array(z.string()),
});

export const machOutput = z.object({
  mach: z.object({
    wallet: z.string(),
    chain_id: z.number(),
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
    balance: z.object({
      total: z.string().nullable(),
      locked: z.string(),
      pending_refund: z.string(),
      available: z.string().nullable(),
      active_sessions: z.number(),
      symbol: z.string(),
      error: z.object({ code: z.literal("E_RPC"), message: z.string() }).optional(),
    }),
    balances: z.array(
      z.object({
        token: z.string(),
        symbol: z.string(),
        decimals: z.number(),
        balance: z.string(),
        verified: z.boolean(),
        access_key_limit: z.string().nullable(),
      }),
    ),
    key: z
      .object({
        address: z.string(),
        chain_id: z.number(),
        network: z.string(),
        symbol: z.string(),
        token: z.string(),
        balance: z.string().nullable(),
        balance_error: z.object({ code: z.literal("E_RPC"), message: z.string() }).optional(),
        spending_limit: z.object({
          mode: z.enum(["unknown", "unrestricted", "none", "restricted"]),
          unlimited: z.boolean().nullable(),
          limit: z.string().nullable(),
          period_seconds: z.number().nullable(),
          remaining: z.string().nullable(),
          spent: z.string().nullable(),
        }),
        spending_limits: z.array(
          z.object({
            unlimited: z.boolean(),
            symbol: z.string(),
            token: z.string(),
            limit: z.string(),
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
]);

export const keysOutput = z.object({
  keys: z.array(
    z.object({
      address: z.string(),
      chain_id: z.number(),
      network: z.string(),
      wallet_address: z.string().nullable(),
      symbol: z.string(),
      token: z.string(),
      balance: z.string().nullable(),
      balance_error: z.object({ code: z.literal("E_RPC"), message: z.string() }).optional(),
      spending_limit: z.object({
        mode: z.enum(["unknown", "unrestricted", "none", "restricted"]),
        unlimited: z.boolean().nullable(),
        limit: z.string().nullable(),
        period_seconds: z.number().nullable(),
        remaining: z.string().nullable(),
        spent: z.string().nullable(),
      }),
      spending_limits: z.array(
        z.object({
          unlimited: z.boolean(),
          symbol: z.string(),
          token: z.string(),
          limit: z.string(),
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
    }),
  ),
  total: z.number(),
});

export const revokeArgs = z.object({
  accessKey: z.string().describe("Access key address to revoke (0x...)"),
});

export const revokeOptions = z.object({
  ...globalOptionShape,
  "dry-run": z.boolean().optional().describe("Show the revoke request without submitting it"),
});

export const revokeOutput = z.object({
  status: z.union([z.literal("success"), z.literal("dry_run")]),
  wallet: z.string(),
  access_key: z.string(),
  local_key_removed: z.boolean(),
});

export const updateAccessKeyOutput = z.object({
  status: z.literal("success"),
  wallet: z.string(),
  access_key: z.string(),
  chain_id: z.number(),
  token: z.string(),
  limit: z.string(),
});

export const updateAccessKeyOptions = z.object({
  ...globalOptionShape,
  limit: z.string().describe("New remaining limit in human token units"),
  token: z.string().optional().describe("Token address; defaults to the current limit token"),
  browser: z.boolean().default(true).describe("Open a browser; use --no-browser to disable"),
});

export const updateAccessKeyArgs = z.object({
  accessKey: z.string().optional().describe("Access key address; defaults to the connected key"),
});

export const transferDryRunOutput = z.object({
  status: z.literal("dry_run"),
  chain_id: z.number(),
  amount: z.string(),
  symbol: z.string(),
  token: z.string(),
  to: z.string(),
  from: z.string(),
});

export const transferSuccessOutput = z.object({
  status: z.literal("success"),
  tx_hash: z.string(),
  chain_id: z.number(),
  amount: z.string(),
  symbol: z.string(),
  token: z.string(),
  to: z.string(),
  from: z.string(),
});

export const spendMachOutput = z.object({
  wallet: z.string().optional(),
  amount: z.string(),
  amount_raw: z.string(),
  token: z.literal("MACH"),
  settlement_currency: z.string(),
  chain_id: z.number(),
  challenge_id: z.string(),
  max_spend: z.string().nullable(),
  tx_hash: z.string().optional(),
  dry_run: z.boolean().optional(),
});

export const sessionOutput = z.object({
  channel_id: z.string(),
  network: z.string(),
  origin: z.string(),
  symbol: z.string(),
  deposit: z.string(),
  spent: z.string(),
  remaining: z.string(),
  status: z.string(),
  remaining_secs: z.number().optional(),
  created_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
});

export const sessionsListOutput = z.object({
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
});

export const debugOutput = z.object({
  wallet_version: z.string(),
  request_version: z.string(),
  os: z.string(),
  arch: z.string(),
  network: z.string(),
  wallet: z.string().nullable(),
  wallet_type: z.string(),
  logged_in: z.boolean(),
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
  chain_id: z.number(),
  token: z.string(),
  symbol: z.string().optional(),
  amount: z.string().nullable(),
  balance: z.string().nullable(),
  raw_balance: z.string().nullable(),
});

export const loginOptions = z.object({
  ...globalOptionShape,
  browser: z.boolean().default(true).describe("Open a browser; use --no-browser to disable"),
});

export const globalOptions = z.object(globalOptionShape);

export const loginOutput = z.union([
  whoamiOutput,
  z.object({
    accounts: z.array(z.string()),
    chainId: z.number(),
  }),
]);

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
  credits: z.boolean().optional().describe("Alias for --mach"),
});

export const transferArgs = z.object({
  amount: z.string().optional().describe('Amount in human units ("1.00", "50")'),
  token: z.string().optional().describe("Token contract address (0x...)"),
  to: z.string().optional().describe("Recipient address (0x...)"),
});

export const transferOptions = z.object({
  ...globalOptionShape,
  "fee-token": z.string().optional().describe("Pay fees in a different token"),
  "dry-run": z.boolean().optional().describe("Show plan + fee estimate, don't send"),
  mach: z.boolean().optional().describe("Pay with on-chain MACH"),
  credits: z.boolean().optional().describe("Alias for --mach"),
  "max-spend": z
    .string()
    .optional()
    .describe("Maximum MACH spend in USD for the exact MPP challenge"),
  "amount-cents": z.coerce
    .number()
    .optional()
    .describe("Legacy alias for a MACH spending cap in USD cents"),
  to: z.string().optional().describe("Legacy direct recipient option; unsupported with MACH"),
  data: z.string().optional().describe("Legacy calldata option; unsupported with MACH"),
  value: z.string().optional().describe("Legacy ETH value option; unsupported with MACH"),
  "mpp-challenge": z.string().optional().describe("MPP WWW-Authenticate challenge"),
  "mpp-challenge-file": z.string().optional().describe("File containing an MPP challenge"),
  "mpp-client-id": z.string().optional().describe("Optional client ID for MPP attribution memo"),
  address: z.string().optional().describe("Wallet address (defaults to current wallet)"),
});

export const transferOutput = z.union([
  transferDryRunOutput,
  transferSuccessOutput,
  spendMachOutput,
]);

export const swapArgs = z.object({
  amount: z
    .string()
    .describe("Exact input amount by default; exact output amount with --exact-out"),
  tokenIn: z.string().describe("Full input token address (0x...)"),
  tokenOut: z.string().describe("Full output token address (0x...)"),
});

export const swapOptions = z.object({
  ...globalOptionShape,
  "exact-out": z.boolean().optional().describe("Treat amount as the exact output amount"),
  "slippage-bps": z.coerce.number().default(50).describe("Maximum slippage in basis points"),
  "fee-token": z.string().optional().describe("Token used to pay fees; defaults to tokenIn"),
  "dry-run": z.boolean().optional().describe("Quote and show calls without submitting"),
  yes: z.boolean().optional().describe("Confirm the reviewed swap for submission"),
});

const swapBaseOutputShape = {
  chain_id: z.number(),
  mode: z.union([z.literal("exact_in"), z.literal("exact_out")]),
  from: z.string(),
  dex: z.string(),
  token_in: z.string(),
  token_in_symbol: z.string(),
  token_out: z.string(),
  token_out_symbol: z.string(),
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
  z.object({ status: z.literal("dry_run"), ...swapBaseOutputShape }),
  z.object({ status: z.literal("success"), tx_hash: z.string(), ...swapBaseOutputShape }),
]);

export const fundOptions = z.object({
  ...globalOptionShape,
  address: z.string().optional().describe("Wallet address to fund (defaults to current wallet)"),
  browser: z.boolean().default(true).describe("Open a browser; use --no-browser to disable"),
  crypto: z.boolean().optional().describe("Open the direct crypto funding flow"),
  mach: z.boolean().optional().describe("Open the MACH funding flow (default)"),
  credits: z.boolean().optional().describe("Alias for --mach"),
  amount: z.string().optional().describe("MACH checkout amount: 5–100 USD, up to 2 decimal places"),
  wait: z.boolean().default(true).describe("Wait for funds; use --no-wait for a JSON handoff"),
  timeout: z.coerce.number().optional().describe("Funding wait timeout in seconds (default: 600)"),
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
  finalize: z.boolean().optional().describe("Finalize channels pending close"),
  cooperative: z.boolean().optional().describe("Use cooperative close only"),
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
  search: z.string().optional().describe("Search by name, description, tags, or category"),
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
  shell: z.enum(["bash", "elvish", "fish", "powershell", "zsh"]).optional(),
});
