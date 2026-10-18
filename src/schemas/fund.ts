import { z } from "incur";

import { displayMeta } from "../cli/render.js";
import {
  browserOption,
  describeMeta,
  globalOptionShape,
  networkOutputShape,
  nextOutputShape,
} from "./shared.js";

export const fundOptions = z.object({
  ...globalOptionShape,
  address: z.string().optional().describe("Wallet address to fund (defaults to current wallet)"),
  browser: browserOption,
  crypto: z.boolean().optional().describe("Open the direct crypto funding flow"),
  mach: z.boolean().optional().describe("Open the MACH funding flow"),
  credits: z.boolean().optional().describe("Unavailable; use --mach to buy MACH"),
  amount: z
    .string()
    .optional()
    .describe("USD amount to prefill; MACH: 5–100, up to 2 decimal places"),
  wait: z
    .boolean()
    .default(false)
    .describe("Wait for a balance increase; otherwise return immediately")
    .register(describeMeta, { negated: "Return the funding handoff immediately (default)" }),
  timeout: z.coerce
    .number()
    .optional()
    .describe("Timeout in seconds with --wait (default: 600)")
    .register(describeMeta, { valueName: "SECONDS" }),
  "referral-code": z
    .string()
    .optional()
    .describe("Open referral-code redeem flow")
    .register(describeMeta, { valueName: "CODE" }),
});

export const fundStatusOptions = z.object({
  ...globalOptionShape,
  interval: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Seconds between balance checks (default: 2)")
    .register(describeMeta, { valueName: "SECONDS" }),
  "max-attempts": z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Checks before giving up with E_POLL_TIMEOUT (default: until the funding expires)")
    .register(describeMeta, { valueName: "COUNT" }),
});

export const fundOutput = z.object({
  status: z.enum(["success", "pending"]).register(displayMeta, { tone: { success: "ok" } }),
  wallet: z.string().nullable(),
  action: z.string(),
  url: z.string(),
  ...networkOutputShape,
  token: z.string().register(displayMeta, { address: true }),
  symbol: z.string().nullable(),
  amount: z.string().nullable(),
  balance: z.string().register(displayMeta, { amount: "symbol" }).nullable(),
  raw_balance: z.string().register(displayMeta, { hidden: true }).nullable(),
  ...nextOutputShape,
});
