import { z } from "incur";

import { sendArgs, sendOptions, sendOutput } from "./send.js";
import { networkOutputShape, nextOutputShape } from "./shared.js";

// A token transfer is `send` under its former name, so it takes the same arguments and options.
export const transferArgs = sendArgs.partial();

const { address, ...sendOptionShape } = sendOptions.shape;

export const transferOptions = z.object({
  ...sendOptionShape,
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
  address,
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

export const transferOutput = z.union([...sendOutput.options, spendMachOutput, spendCreditsOutput]);
