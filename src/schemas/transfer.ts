import { z } from "incur";

import {
  globalOptionShape,
  idempotencyKeyOption,
  networkOutputShape,
  nextOutputShape,
  replayOutputShape,
} from "./shared.js";

export const transferArgs = z.object({
  amount: z.string().optional().describe('Amount in human units ("1.00", "50")'),
  token: z.string().optional().describe("Token address (0x...) or symbol (e.g. USDC.e)"),
  to: z.string().optional().describe("Recipient address (0x...)"),
});

export const transferOptions = z.object({
  ...globalOptionShape,
  "fee-token": z.string().optional().describe("Pay fees in a different token (address or symbol)"),
  "dry-run": z.boolean().optional().describe("Show plan, fee estimate, and balance; don't send"),
  yes: z
    .boolean()
    .optional()
    .describe("Send without the confirmation prompt; required for agent runs"),
  "idempotency-key": idempotencyKeyOption,
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

export const transferDryRunOutput = z.object({
  status: z.literal("dry_run"),
  ...networkOutputShape,
  amount: z.string(),
  symbol: z.string().nullable(),
  token: z.string(),
  to: z.string(),
  from: z.string(),
  fee_token: z
    .string()
    .nullable()
    .describe(
      "--fee-token, else the account's default fee token, else the transferred token; null when the default cannot be read",
    ),
  fee_estimate: z
    .string()
    .nullable()
    .describe("Estimated network fee in fee_token units; null when the estimate failed"),
  balance: z.string().nullable().describe("Sender's token balance; null when the lookup failed"),
  fee_token_balance: z
    .string()
    .nullable()
    .describe("Sender's fee_token balance; null when the lookup failed or fee_token is null"),
  sufficient_balance: z
    .boolean()
    .nullable()
    .describe(
      "Whether balance covers amount and fee_token_balance covers fee_estimate (both, when they are the same token); false on any known shortfall, else null when unknown",
    ),
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

export const transferOutput = z.union([
  transferDryRunOutput,
  transferSuccessOutput,
  transferSuccessOutput.extend(replayOutputShape),
  spendMachOutput,
  spendCreditsOutput,
]);
