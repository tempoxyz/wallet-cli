import { z } from "incur";

import {
  globalOptionShape,
  idempotencyKeyOption,
  networkOutputShape,
  nextOutputShape,
  replayOutputShape,
} from "./shared.js";

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
  "idempotency-key": idempotencyKeyOption,
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

export const swapSuccessOutput = z.object({
  status: z.literal("success"),
  tx_hash: z.string(),
  ...swapBaseOutputShape,
});

export const swapOutput = z.union([
  z.object({ status: z.literal("dry_run"), ...swapBaseOutputShape, ...nextOutputShape }),
  swapSuccessOutput,
  swapSuccessOutput.extend(replayOutputShape),
]);
