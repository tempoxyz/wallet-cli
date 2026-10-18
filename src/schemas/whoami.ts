import { z } from "incur";

import { displayMeta } from "../cli/render.js";
import { accessKeyOutput } from "./keys.js";
import { globalOptionShape, networkOutputShape } from "./shared.js";

export const whoamiOptions = z.object({
  ...globalOptionShape,
  mach: z.boolean().optional().describe("Show on-chain MACH balance"),
  credits: z.boolean().optional().describe("Show existing MPP Credits balance (deprecated)"),
});

export const creditsOutput = z.object({
  credits: z
    .object({
      wallet: z.string(),
      balance: z.string(),
      rawBalance: z.string().register(displayMeta, { hidden: true }),
    })
    .nullable(),
});

export const machOutput = z.object({
  mach: z.object({
    wallet: z.string(),
    ...networkOutputShape,
    token: z.string().register(displayMeta, { address: true }),
    symbol: z.literal("MACH"),
    decimals: z.number().register(displayMeta, { hidden: true }),
    balance: z.string().register(displayMeta, { amount: "symbol" }),
    raw_balance: z.string().register(displayMeta, { hidden: true }),
  }),
});

const amount = { amount: "symbol" };

export const whoamiOutput = z.union([
  z.object({ ready: z.boolean() }),
  z.object({
    ready: z
      .boolean()
      .describe(
        "Whether the wallet is logged in with an access key on this network that can pay (key.status ready or pending) and its balance query succeeded",
      ),
    wallet: z.string().nullable(),
    ...networkOutputShape,
    balance: z.object({
      total: z.string().register(displayMeta, amount).nullable(),
      locked: z.string().register(displayMeta, amount),
      pending_refund: z.string().register(displayMeta, amount),
      available: z.string().register(displayMeta, amount).nullable(),
      active_sessions: z.number(),
      symbol: z.string().nullable(),
      error: z.object({ code: z.literal("E_RPC"), message: z.string() }).optional(),
    }),
    balances: z.array(
      z.object({
        token: z.string().register(displayMeta, { address: true }),
        symbol: z.string().nullable(),
        decimals: z.number().register(displayMeta, { hidden: true }),
        balance: z.string().register(displayMeta, amount),
        verified: z.boolean(),
        access_key_limit: z.string().register(displayMeta, amount).nullable(),
      }),
    ),
    key: accessKeyOutput.omit({ wallet: true }).nullable(),
  }),
  machOutput,
  creditsOutput,
]);
