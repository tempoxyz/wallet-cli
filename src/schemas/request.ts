import { z } from "incur";

import { displayMeta } from "../cli/render.js";
import { networkOutputShape, nextOutputShape } from "./shared.js";

/** `tempo request --dry-run`: a quote for a 402, else the status of a probe that needed no payment. */
export const requestDryRunOutput = z.union([
  z.object({
    payment_required: z.literal(true),
    method: z.string(),
    intent: z.string(),
    recurring: z.boolean(),
    amount: z.string().describe("Per-call amount"),
    raw_amount: z.string().register(displayMeta, { hidden: true }),
    session: z
      .enum(["open", "reuse"])
      .nullable()
      .describe("Whether a session payment opens a channel or reuses a stored one"),
    deposit: z
      .string()
      .nullable()
      .describe(
        "Deposit the payment locks: a new session's deposit, or the top-up a reused session's voucher needs",
      ),
    raw_deposit: z.string().register(displayMeta, { hidden: true }).nullable(),
    token: z.string(),
    symbol: z.string().nullable().describe("Listed symbol; null for a token viem does not list"),
    decimals: z.number().nullable(),
    balance: z.string().nullable().describe("Payer's balance of the token the payment debits"),
    access_key_limit: z
      .string()
      .nullable()
      .describe(
        "Active access key's stored limit for the token the payment debits; 0 when exact stored limits leave it out",
      ),
    machine_token_enabled: z.boolean(),
    payment_token: z.string().nullable(),
    ...networkOutputShape,
    max_spend: z
      .string()
      .nullable()
      .describe(
        "Spending cap the payment applies: --max-spend, TEMPO_MAX_SPEND, the saved max-spend setting, or the default; null for a subscription",
      ),
    within_budget: z
      .boolean()
      .nullable()
      .describe(
        "Whether the spend fits max_spend; null for a subscription, or when a session's payer or plan is unknown",
      ),
    signer: z.object({
      address: z.string().nullable(),
      source: z.enum(["flag", "env", "wallet"]),
    }),
    // Set when the wallet cannot pay: the login or refresh command that fixes it.
    ...nextOutputShape,
  }),
  z.object({
    payment_required: z.literal(false),
    status: z.number().describe("HTTP status of the probe, which needed no payment"),
    probe_sent: z.literal(true),
    warning: z.string().optional(),
  }),
]);
