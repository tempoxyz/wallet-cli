import { z } from "incur";

import { globalOptionShape, networkOutputShape, nextOutputShape } from "./shared.js";

/** A session's state: `finalizable` once a requested close's grace period has ended. */
export const sessionStatusSchema = z.enum([
  "active",
  "closing",
  "finalizable",
  "finalized",
  "orphaned",
]);

export const sessionOutput = z.object({
  channel_id: z.string(),
  network: z.string(),
  origin: z.string(),
  symbol: z.string().nullable(),
  deposit: z.string(),
  spent: z.string(),
  remaining: z.string(),
  status: sessionStatusSchema,
  remaining_seconds: z
    .number()
    .optional()
    .describe("Seconds until a closing session's deposit can be withdrawn"),
  created_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
});

export const sessionsListOptions = z.object({
  ...globalOptionShape,
  orphaned: z.boolean().optional().describe("Include on-chain orphaned discovery"),
  all: z.boolean().optional().describe("Include local sessions and orphaned discovery"),
});

export const sessionsListOutput = z.object({
  ...networkOutputShape,
  sessions: z.array(sessionOutput),
  total: z.number(),
});

export const sessionsCloseArgs = z.object({
  target: z.string().optional().describe("URL, origin, or channel ID (0x...) to close"),
});

export const sessionsCloseOptions = z.object({
  ...globalOptionShape,
  all: z.boolean().optional().describe("Close all active sessions and on-chain channels"),
  orphaned: z.boolean().optional().describe("Close only orphaned on-chain channels"),
  finalize: z.boolean().optional().describe("Withdraw channels whose close grace period has ended"),
  cooperative: z
    .boolean()
    .optional()
    .describe("Close now through the session's server instead of waiting out the grace period"),
  "dry-run": z.boolean().optional().describe("Show what would be closed without executing"),
  yes: z
    .boolean()
    .optional()
    .describe("Close without the confirmation prompt; required for agent runs"),
});

export const sessionsCloseDryRunOutput = z.object({
  status: z.literal("dry_run"),
  targets: z.array(
    z.object({
      channel_id: z.string().describe("Channel ID; empty when no session matches the origin"),
      origin: z.string().optional(),
      status: z
        .enum([...sessionStatusSchema.options, "not_found"])
        .optional()
        .describe("The session's status, as sessions list reports it; not_found when none matches"),
    }),
  ),
  ...nextOutputShape,
});

export const sessionsCloseOutput = z.object({
  closed: z.number(),
  pending: z.number(),
  failed: z.number(),
  results: z.array(z.unknown()),
  ...nextOutputShape,
});

export const sessionsCloseCommandOutput = z.union([sessionsCloseDryRunOutput, sessionsCloseOutput]);

export const sessionsSyncOptions = z.object({
  ...globalOptionShape,
  origin: z.string().optional().describe("Re-sync a specific origin's close state from on-chain"),
});
