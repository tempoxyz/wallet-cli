import { z } from "incur";

import { accessKeyOutput } from "./keys.js";
import { browserOption, globalOptionShape, networkOutputShape, nextOutputShape } from "./shared.js";

export const revokeArgs = z.object({
  accessKey: z.string().describe("Access key address to revoke (0x...)"),
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
