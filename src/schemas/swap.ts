import { z } from "incur";

import { displayMeta } from "../cli/render.js";
import {
  describeMeta,
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
  "token-in": z.string().describe("Input token address (0x...) or symbol (e.g. USDC.e)"),
  "token-out": z.string().describe("Output token address (0x...) or symbol (e.g. pathUSD)"),
});

export const swapOptions = z.object({
  ...globalOptionShape,
  "exact-out": z.boolean().optional().describe("Treat amount as the exact output amount"),
  "slippage-bps": z.coerce
    .number()
    .default(50)
    .describe("Maximum slippage in basis points")
    .register(describeMeta, { valueName: "BPS" }),
  "min-amount-out": z
    .string()
    .optional()
    .describe("Exact input: refuse to receive less than this reviewed token-out amount")
    .register(describeMeta, { valueName: "AMOUNT" }),
  "max-amount-in": z
    .string()
    .optional()
    .describe("Exact output: refuse to spend more than this reviewed token-in amount")
    .register(describeMeta, { valueName: "AMOUNT" }),
  "fee-token": z
    .string()
    .optional()
    .describe("Token address or symbol used to pay fees; defaults to token-in"),
  "dry-run": z.boolean().optional().describe("Quote and show calls without submitting"),
  yes: z.boolean().optional().describe("Confirm the reviewed swap for submission"),
  "idempotency-key": idempotencyKeyOption,
});

const address = { address: true };
const amountIn = { amount: "token_in_symbol" };
const amountOut = { amount: "token_out_symbol" };

const swapBaseOutputShape = {
  ...networkOutputShape,
  mode: z.union([z.literal("exact_in"), z.literal("exact_out")]),
  from: z.string(),
  dex: z.string().register(displayMeta, address),
  token_in: z.string().register(displayMeta, address),
  token_in_symbol: z.string().nullable(),
  token_out: z.string().register(displayMeta, address),
  token_out_symbol: z.string().nullable(),
  amount_in: z.string().register(displayMeta, amountIn),
  max_amount_in: z.string().register(displayMeta, amountIn),
  amount_out: z.string().register(displayMeta, amountOut),
  min_amount_out: z.string().register(displayMeta, amountOut),
  slippage_bps: z.number(),
  fee_token: z.string().register(displayMeta, address),
  access_key_limit: z.string().register(displayMeta, amountIn).nullable(),
  requires_access_key_update: z.boolean(),
  calls: z
    .array(z.object({ to: z.string(), data: z.string() }))
    .register(displayMeta, { hidden: true }),
};

export const swapSuccessOutput = z.object({
  status: z.literal("success").register(displayMeta, { tone: { success: "ok" } }),
  tx_hash: z.string(),
  ...swapBaseOutputShape,
});

export const swapOutput = z.union([
  z.object({ status: z.literal("dry_run"), ...swapBaseOutputShape, ...nextOutputShape }),
  swapSuccessOutput,
  swapSuccessOutput.extend(replayOutputShape),
]);
