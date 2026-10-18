import { z } from "incur";

import {
  globalOptionShape,
  idempotencyKeyOption,
  networkOutputShape,
  nextOutputShape,
  replayOutputShape,
} from "./shared.js";

export const sendArgs = z.object({
  amount: z.string().describe('Amount in human units ("1.00", "50")'),
  token: z.string().describe("Token address (0x...) or symbol (e.g. USDC.e)"),
  to: z.string().describe("Recipient address (0x...)"),
});

export const sendOptions = z.object({
  ...globalOptionShape,
  "fee-token": z
    .string()
    .optional()
    .describe(
      "Pay fees in a different token, by address or symbol (default: the account's fee token, else the same token)",
    ),
  "dry-run": z.boolean().optional().describe("Show plan, fee estimate, and balance; don't send"),
  yes: z
    .boolean()
    .optional()
    .describe("Send without the confirmation prompt; required for agent runs"),
  "idempotency-key": idempotencyKeyOption,
  address: z
    .string()
    .optional()
    .describe("Guard: refuse unless this is the logged-in wallet's address"),
});

export const sendDryRunOutput = z.object({
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

export const sendSuccessOutput = z.object({
  status: z.literal("success"),
  tx_hash: z.string(),
  ...networkOutputShape,
  amount: z.string(),
  symbol: z.string().nullable(),
  token: z.string(),
  to: z.string(),
  from: z.string(),
});

export const sendOutput = z.union([
  sendDryRunOutput,
  sendSuccessOutput,
  sendSuccessOutput.extend(replayOutputShape),
]);
