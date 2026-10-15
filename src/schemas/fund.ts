import { z } from "incur";

import { browserOption, globalOptionShape, networkOutputShape, nextOutputShape } from "./shared.js";

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
    .describe("Wait for a balance increase; otherwise return immediately"),
  timeout: z.coerce.number().optional().describe("Timeout in seconds with --wait (default: 600)"),
  "referral-code": z.string().optional().describe("Open referral-code redeem flow"),
  claim: z.string().optional().describe("Alias for --referral-code"),
});

export const fundStatusOptions = z.object({
  ...globalOptionShape,
  interval: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Seconds between balance checks (default: 2)"),
  "max-attempts": z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Checks before giving up with E_POLL_TIMEOUT (default: until the funding expires)"),
});

export const fundOutput = z.object({
  status: z.enum(["success", "pending"]),
  wallet: z.string().nullable(),
  action: z.string(),
  url: z.string(),
  ...networkOutputShape,
  token: z.string(),
  symbol: z.string().optional(),
  amount: z.string().nullable(),
  balance: z.string().nullable(),
  raw_balance: z.string().nullable(),
  ...nextOutputShape,
});
