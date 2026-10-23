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
    balance: z.string().nullable().describe("Payer's balance of the advertised settlement token"),
    access_key_limit: z
      .string()
      .nullable()
      .describe(
        "Active access key's stored limit for the advertised settlement token; 0 when exact stored limits leave it out",
      ),
    mach: z
      .object({
        token: z.string(),
        symbol: z.literal("MACH"),
        balance: z.string().nullable().describe("Payer's MACH balance; null when unknown"),
        access_key_limit: z.string().nullable().describe("Active access key's stored MACH limit"),
      })
      .nullable()
      .describe("MACH balance for eligible charges; null for other payment offers"),
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
    funding: z
      .object({
        route: z
          .string()
          .nullable()
          .describe(
            "The funder that would acquire the token, such as tempo-dex, or the bridge route, such as relay or stargate; null when no bridge route quoted",
          ),
        inputs: z.array(z.string()).describe("Tokens it may spend, most preferred first"),
        shortfall: z
          .string()
          .optional()
          .describe("Bridge only: the USDC the payer lacks, which the bridge delivers"),
        raw_shortfall: z.string().register(displayMeta, { hidden: true }).optional(),
        source_token: z
          .string()
          .nullable()
          .optional()
          .describe("Bridge only: the Tempo token the bridge spends"),
        source_symbol: z.string().nullable().optional(),
        amount_in: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Bridge only: the chosen route's quoted debit of the source token, fee included",
          ),
        raw_amount_in: z.string().register(displayMeta, { hidden: true }).nullable().optional(),
        fee: z
          .string()
          .nullable()
          .optional()
          .describe("Bridge only: the bridge's fee, amount_in beyond the shortfall"),
        gas: z
          .string()
          .nullable()
          .optional()
          .describe("Bridge only: most the Tempo transaction's gas may cost, in the source token"),
        total: z
          .string()
          .nullable()
          .optional()
          .describe("Bridge only: most the funding may debit, fee and gas included"),
        max_funding_spend: z
          .string()
          .optional()
          .describe(
            "Bridge only: the cap on total, from --max-funding-spend, else --max-spend plus 5% and 0.10",
          ),
        within_funding_budget: z
          .boolean()
          .nullable()
          .optional()
          .describe(
            "Bridge only: whether total fits max_funding_spend; null when no route quoted. When no quote fits, route is the cheapest one",
          ),
        quotes: z
          .array(
            z.object({
              route: z.string(),
              amount_in: z.string().nullable(),
              fee: z.string().nullable(),
              gas: z.string().nullable(),
              total: z.string().nullable(),
              within_funding_budget: z.boolean().nullable(),
              reason: z.string().nullable().describe("Why the route declined to quote"),
            }),
          )
          .optional()
          .describe("Bridge only: every route's quote, or why it declined, in preference order"),
        reason: z
          .string()
          .optional()
          .describe("Bridge only: why no route can fund the payment, when none can"),
      })
      .optional()
      .describe(
        "Set when the payer's balance is below the amount and a funder would acquire the rest, or with --funding auto a bridge would deliver it; nothing is swapped, bridged, or saved in a dry run",
      ),
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
