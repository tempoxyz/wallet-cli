import { z } from "incur";

import { networkOutputShape, nextOutputShape, txStateSchema } from "./shared.js";

export const txStatusArgs = z.object({
  "tx-hash": z.string().describe("Transaction hash (0x...)"),
});

export const txStatusOutput = z.object({
  tx_hash: z.string(),
  ...networkOutputShape,
  status: txStateSchema,
  block_number: z.number().nullable().describe("Block that included it; null until included"),
  from: z.string().nullable().describe("Sender; null when not found"),
  to: z.string().nullable().describe("Recipient; null when not found or when it has none"),
  fee: z.string().nullable().describe("Network fee paid, in fee_token units; null until included"),
  fee_token: z.string().nullable().describe("Token the fee was paid in; null when unknown"),
  ...nextOutputShape,
});
