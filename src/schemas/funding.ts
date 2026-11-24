import { z } from "incur";

import { displayMeta } from "../cli/render.js";
import { globalOptionShape, networkOutputShape, nextOutputShape } from "./shared.js";

export const fundingOperationOutput = z.object({
  id: z.string().describe("The funding attempt and operation ID"),
  url: z.string().describe("The request the funding paid for"),
  destination: z.string().describe("The chain funded, such as base"),
  payer: z
    .string()
    .describe("The account funds are delivered to")
    .register(displayMeta, { address: true }),
  source: z
    .string()
    .describe("The Tempo account the funding spends from")
    .register(displayMeta, { address: true }),
  created_at: z.string(),
  status: z
    .enum(["not_started", "claimed", "submitted"])
    .describe(
      "not_started: nothing was quoted or sent; claimed: quoted, maybe sent; submitted: the deposit was sent",
    ),
  route: z.string().nullable(),
  reference: z.string().nullable().describe("The route's request ID, once known"),
  amount_out: z.string().nullable().describe("USDC to deliver"),
  max_amount_in: z.string().nullable().describe("Most OUSD the deposit may spend"),
});

export const fundingListOptions = z.object({ ...globalOptionShape });

export const fundingListOutput = z.object({
  ...networkOutputShape,
  operations: z.array(fundingOperationOutput),
  total: z.number(),
});

export const fundingRecoverArgs = z.object({
  id: z.string().describe("Funding operation ID, from a failed request or 'funding list'"),
});

export const fundingRecoverOptions = z.object({ ...globalOptionShape });

export const fundingRecoverOutput = z.object({
  ...networkOutputShape,
  id: z.string(),
  status: z
    .enum(["not_started", "pending", "completed", "refunded", "action_required"])
    .describe(
      "completed: USDC was delivered; refunded: the OUSD came back; pending: still in flight; action_required: contact Relay",
    ),
  reference: z.string().nullable(),
  ...nextOutputShape,
});
