import { z } from "incur";

import { sessionOutput } from "./sessions.js";
import { browserOption, globalOptionShape, networkOutputShape, nextOutputShape } from "./shared.js";

export const logoutOptions = z.object({
  ...globalOptionShape,
  revoke: z
    .boolean()
    .optional()
    .describe("Revoke the access keys on-chain through the wallet app before removing them"),
  yes: z
    .boolean()
    .optional()
    .describe(
      "Log out without a prompt when stored sessions hold unspent deposits or with --revoke",
    ),
  browser: browserOption,
});

export const logoutOutput = z.object({
  was_logged_in: z
    .boolean()
    .describe("Whether a wallet or access keys were stored for the networks logged out"),
  disconnected: z.boolean().describe("Whether the wallet is no longer stored on this machine"),
  wallet: z.string().nullable(),
  scope: z
    .enum(["all", "mainnet", "testnet"])
    .describe("The network logged out of with --network, or all networks"),
  keys: z
    .array(
      z.object({
        address: z.string(),
        wallet: z.string(),
        ...networkOutputShape,
        revoked: z
          .boolean()
          .describe("Revoked on-chain; otherwise removed locally and authorized until it expires"),
      }),
    )
    .describe("Access keys removed from this machine"),
  sessions: z
    .array(sessionOutput)
    .describe(
      "Stored sessions that still hold unspent deposits, on the networks logged out or, when the wallet is removed, on every network",
    ),
  message: z.string(),
  ...nextOutputShape,
});
