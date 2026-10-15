import { z } from "incur";

import { globalOptionShape, networkOutputShape, nextOutputShape } from "./shared.js";

export const sessionOutput = z.object({
  channel_id: z.string(),
  network: z.string(),
  origin: z.string(),
  symbol: z.string().nullable(),
  deposit: z.string(),
  spent: z.string(),
  remaining: z.string(),
  status: z.string(),
  remaining_secs: z.number().optional(),
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
  url: z.string().optional().describe("URL, origin, or channel ID (0x...) to close"),
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
  targets: z.array(z.unknown()),
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
