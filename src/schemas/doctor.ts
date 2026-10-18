import { z } from "incur";

import { displayMeta } from "../cli/render.js";
import { accessKeyOutput } from "./keys.js";
import { networkOutputShape, nextOutputShape } from "./shared.js";

export const doctorOutput = z.object({
  ...networkOutputShape,
  versions: z.object({
    wallet_cli: z.string(),
    node: z.string(),
    platform: z.string(),
    arch: z.string(),
    incur: z.string().nullable(),
    accounts: z.string().nullable(),
  }),
  wallet: z.object({
    logged_in: z.boolean(),
    address: z.string().nullable(),
    type: z
      .enum(["passkey", "private_key", "device_code"])
      .nullable()
      .describe("What signs for the account, from the key type the wallet store records"),
    chain_id: z.number().nullable().describe("The wallet store's chain"),
    network: z.string().nullable(),
    private_key_env: z
      .boolean()
      .describe("Whether TEMPO_PRIVATE_KEY is set; its value is never shown"),
  }),
  key: z.object({
    address: z.string().nullable(),
    status: z.enum(["ready", "pending", "expired", "unusable", "missing"]),
    expires_at: z.string().nullable(),
    spending_limits: accessKeyOutput.shape.spending_limits,
  }),
  rpc: z.object({
    url: z.string().describe("RPC URL with credentials, path, and query redacted"),
    ok: z.boolean().describe("Whether the RPC answered eth_chainId"),
    chain_id: z.number().nullable(),
    chain_matches: z.boolean().nullable(),
    latency_ms: z.number().nullable(),
  }),
  auth: z.object({ url: z.string().describe("Wallet app URL, redacted like rpc.url") }),
  sqlite3: z.object({ found: z.boolean(), version: z.string().nullable() }),
  session_store: z.object({
    path: z.string(),
    exists: z.boolean().nullable().describe("null when the path cannot be checked"),
    readable: z.boolean(),
  }),
  env: z
    .array(z.object({ name: z.string(), value: z.string().nullable() }))
    .describe("Overrides that are set; value is null for a secret and redacted for a URL"),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z
        .enum(["ok", "warn", "fail"])
        .register(displayMeta, { tone: { ok: "ok", fail: "error" } }),
      message: z.string(),
    }),
  ),
  ...nextOutputShape,
});
