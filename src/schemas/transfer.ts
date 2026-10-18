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
  credits: z.boolean().optional().describe("Spend existing MPP Credits (deprecated)"),
  "max-spend": z
    .string()
    .optional()
    .describe("Maximum MACH spend for the exact MPP challenge, in MACH (1 MACH = 1 USD)")
    .register(describeMeta, { valueName: "AMOUNT" }),
  "amount-cents": z.coerce
    .number()
    .optional()
    .describe("Credits amount or MPP challenge spending cap in USD cents; --credits only"),
  // Named apart from the recipient argument, as `--describe` names each argument once.
  to: z
    .string()
    .optional()
    .describe("Credits recipient; --credits only")
    .register(describeMeta, { name: "credits_to" }),
  data: z.string().optional().describe("Credits calldata; --credits only"),
  "mpp-challenge": z.string().optional().describe("MPP WWW-Authenticate challenge"),
  "mpp-challenge-file": z
    .string()
    .optional()
    .describe("File containing an MPP WWW-Authenticate challenge"),
  "mpp-client-id": z.string().optional().describe("Optional client ID for MPP attribution memo"),
  address: address.describe(
    "Guard: refuse unless this is the paying wallet's address; with --credits, the wallet whose credits to spend (default: the logged-in wallet)",
  ),
});

/** A MACH or MPP Credits payment: reviewed with `--dry-run`, else sent. */
const paymentStatus = z.enum(["dry_run", "success"]);

export const spendCreditsOutput = z.object({
  status: paymentStatus,
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
});

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

export const transferOutput = z.union([...sendOutput.options, spendMachOutput, spendCreditsOutput]);
