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

export const creditsOutput = z.object({
  credits: z
    .object({
      wallet: z.string(),
      balance: z.string(),
      rawBalance: z.string(),
    })
    .nullable(),
});

export const whoamiOutput = z.union([
  z.object({ ready: z.boolean() }),
  z.object({
    ready: z.boolean(),
    wallet: z.string().nullable(),
    balance: z.object({
      total: z.string(),
      locked: z.string(),
      available: z.string(),
      active_sessions: z.number(),
      symbol: z.string(),
    }),
    key: z
      .object({
        address: z.string(),
        chain_id: z.number(),
        network: z.string(),
        symbol: z.string(),
        token: z.string(),
        spending_limit: z.object({
          unlimited: z.boolean(),
          limit: z.string(),
          remaining: z.string().nullable(),
          spent: z.string().nullable(),
        }),
        expires_at: z.string().nullable(),
      })
      .nullable(),
  }),
  creditsOutput,
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
      balance: z.string(),
      spending_limit: z.object({
        unlimited: z.boolean(),
        limit: z.string(),
        remaining: z.string().nullable(),
        spent: z.string().nullable(),
      }),
      expires_at: z.string().nullable(),
    }),
  ),
  total: z.number(),
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

export const spendCreditsOutput = z.object({
  wallet: z.string(),
  amount_cents: z.number(),
  tx_hash: z.string().optional(),
  dry_run: z.boolean().optional(),
});

export const sessionsListOutput = z.object({
  sessions: z.array(z.unknown()),
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
  supportsCredits: z.boolean().optional(),
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
  status: z.literal("success"),
  wallet: z.string().nullable(),
  action: z.string(),
  balance: z.string(),
  raw_balance: z.string(),
});

export const loginOptions = z.object({
  ...globalOptionShape,
  "no-browser": z.boolean().optional().describe("Do not attempt to open a browser"),
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
  credits: z.boolean().optional().describe("Show Coinflow credits balance"),
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
  credits: z.boolean().optional().describe("Pay with Coinflow credits instead of tokens"),
  "amount-cents": z.coerce.number().optional().describe("Amount in USD cents when using --credits"),
  to: z.string().optional().describe("Recipient address when using --credits (0x...)"),
  data: z.string().default("0x").describe("Calldata hex when using --credits"),
  value: z.string().default("0").describe("ETH value in wei when using --credits"),
  "mpp-challenge": z.string().optional().describe("MPP WWW-Authenticate challenge"),
  "mpp-challenge-file": z.string().optional().describe("File containing an MPP challenge"),
  "mpp-client-id": z.string().optional().describe("Optional client ID for MPP attribution memo"),
  address: z.string().optional().describe("Wallet address (defaults to current wallet)"),
});

export const transferOutput = z.union([
  transferDryRunOutput,
  transferSuccessOutput,
  spendCreditsOutput,
]);

export const fundOptions = z.object({
  ...globalOptionShape,
  address: z.string().optional().describe("Wallet address to fund (defaults to current wallet)"),
  "no-browser": z.boolean().optional().describe("Do not attempt to open a browser"),
  crypto: z.boolean().optional().describe("Open the direct crypto funding flow"),
  credits: z.boolean().optional().describe("Open the credits purchase flow"),
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

export const completionsArgs = z.object({
  shell: z.enum(["bash", "elvish", "fish", "powershell", "zsh"]).optional(),
});
