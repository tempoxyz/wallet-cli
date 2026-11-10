import { z } from "incur";

import { displayMeta } from "../cli/render.js";
import { describeMeta, globalOptionShape, networkOutputShape, nextOutputShape } from "./shared.js";

export const transferOptions = z.object({
  ...globalOptionShape,
  "dry-run": z.boolean().optional().describe("Review the MACH payment without sending"),
  "max-spend": z
    .string()
    .optional()
    .describe("Maximum MACH spend for the exact MPP challenge, in MACH (1 MACH = 1 USD)")
    .register(describeMeta, { valueName: "AMOUNT" }),
  "mpp-challenge": z.string().optional().describe("MPP WWW-Authenticate challenge"),
  "mpp-challenge-file": z
    .string()
    .optional()
    .describe("File containing an MPP WWW-Authenticate challenge"),
  "mpp-client-id": z.string().optional().describe("Optional client ID for MPP attribution memo"),
  address: z
    .string()
    .optional()
    .describe("Guard: refuse unless this is the paying wallet's address"),
});

/** A MACH payment: reviewed with `--dry-run`, else sent. */
const paymentStatus = z.enum(["dry_run", "success"]);

export const transferOutput = z.object({
  status: paymentStatus,
  wallet: z.string().optional(),
  amount: z.string().register(displayMeta, { amount: "token" }),
  raw_amount: z
    .string()
    .register(displayMeta, { hidden: true })
    .describe("amount in MACH base units"),
  token: z.literal("MACH"),
  settlement_currency: z.string(),
  ...networkOutputShape,
  challenge_id: z.string(),
  max_spend: z.string().nullable(),
  tx_hash: z.string().optional(),
  ...nextOutputShape,
});
