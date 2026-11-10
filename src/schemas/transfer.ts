import { z } from "incur";

import { displayMeta } from "../cli/render.js";
import { sendArgs, sendOptions, sendOutput } from "./send.js";
import { describeMeta, networkOutputShape, nextOutputShape } from "./shared.js";

// A token transfer is `send` under its former name, so it takes the same arguments and options.
export const transferArgs = sendArgs.partial();

const { address, ...sendOptionShape } = sendOptions.shape;

export const transferOptions = z.object({
  ...sendOptionShape,
  mach: z.boolean().optional().describe("Pay with on-chain MACH"),
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
  address: address.describe("Guard: refuse unless this is the paying wallet's address"),
});

/** A MACH payment: reviewed with `--dry-run`, else sent. */
const paymentStatus = z.enum(["dry_run", "success"]);

export const spendMachOutput = z.object({
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

export const transferOutput = z.union([...sendOutput.options, spendMachOutput]);
