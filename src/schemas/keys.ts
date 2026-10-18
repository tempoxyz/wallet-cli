import { z } from "incur";

import {
  browserOption,
  describeMeta,
  globalOptionShape,
  networkOutputShape,
  nextOutputShape,
} from "./shared.js";

const spendingLimitOutput = z.object({
  unlimited: z.boolean(),
  symbol: z.string().nullable(),
  token: z.string(),
  limit: z.string().nullable(),
  raw_limit: z.string(),
  period_seconds: z.number().nullable(),
  remaining: z
    .string()
    .nullable()
    .describe(
      "Remaining limit read from the chain, in token units; null when the key is not published, the read failed or reached another chain, or the token's decimals are unknown",
    ),
  spent: z
    .string()
    .nullable()
    .describe(
      "Always null: the chain exposes only the remaining limit, not the limit it counts down from, so spending cannot be derived",
    ),
});

/** One access key as `keys list` reports it. */
export const accessKeyOutput = z.object({
  address: z.string(),
  ...networkOutputShape,
  wallet: z.string(),
  symbol: z.string().nullable(),
  token: z.string(),
  balance: z.string().nullable(),
  balance_error: z.object({ code: z.literal("E_RPC"), message: z.string() }).optional(),
  spending_limit: z
    .object({
      mode: z.enum(["unknown", "unrestricted", "none", "restricted"]),
      unlimited: z.boolean().nullable(),
      limit: z.string().nullable(),
      raw_limit: z.string().nullable(),
      period_seconds: z.number().nullable(),
      remaining: z.string().nullable(),
      spent: z.string().nullable(),
    })
    .describe(
      "Deprecated, and will be removed in a future release: use spending_limits. The key's spending mode with the values of spending_limits[0]",
    ),
  spending_limits: z.array(spendingLimitOutput),
  call_permissions: z.enum(["unknown", "unrestricted", "none", "restricted"]),
  scopes: z.array(
    z.object({
      address: z.string(),
      selector: z.string().nullable(),
      recipients: z.array(z.string()),
    }),
  ),
  status: z
    .enum(["ready", "pending", "expired", "unusable"])
    .nullable()
    .describe(
      "ready or pending: the key can pay. pending: signed but not yet published on chain; its first payment publishes it. expired or unusable: it cannot pay",
    ),
  published: z
    .boolean()
    .nullable()
    .describe(
      "Whether the chain holds the key unrevoked: false for a key not yet published, or revoked; null when not read, for another wallet's key, a failed read, or a TEMPO_RPC_URL on another chain",
    ),
  expires_at: z.string().nullable(),
});

export const keysOutput = z.object({
  keys: z.array(accessKeyOutput),
  total: z.number(),
});

export const updateAccessKeyArgs = z.object({
  "access-key": z
    .string()
    .optional()
    .describe("Access key address; defaults to the only key for this wallet and network"),
});

export const updateAccessKeyOptions = z.object({
  ...globalOptionShape,
  limit: z
    .string()
    .describe("New remaining limit in human token units")
    .register(describeMeta, { valueName: "AMOUNT" }),
  token: z
    .string()
    .optional()
    .describe("Token address or symbol (e.g. USDC.e); defaults to the current limit token"),
  browser: browserOption,
});

export const updateAccessKeyOutput = z.object({
  status: z.literal("success"),
  wallet: z.string(),
  access_key: z.string(),
  ...networkOutputShape,
  token: z.string(),
  limit: z.string(),
  ...nextOutputShape,
});

export const revokeArgs = z.object({
  "access-key": z.string().describe("Access key address to revoke (0x...)"),
});

export const revokeOptions = z.object({
  ...globalOptionShape,
  "dry-run": z
    .boolean()
    .optional()
    .describe("Show the key that would be revoked without revoking it"),
  yes: z.boolean().optional().describe("Revoke without a confirmation prompt"),
  browser: browserOption,
});

const revokeOutputShape = {
  wallet: z.string(),
  access_key: z.string(),
  ...networkOutputShape,
  local_key_removed: z.boolean(),
};

export const revokeOutput = z.union([
  z.object({
    status: z.literal("dry_run"),
    ...revokeOutputShape,
    key: accessKeyOutput,
    ...nextOutputShape,
  }),
  z.object({ status: z.literal("success"), ...revokeOutputShape }),
]);
