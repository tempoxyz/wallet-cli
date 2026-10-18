import { z } from "incur";

import {
  browserOption,
  describeMeta,
  globalOptionShape,
  networkOutputShape,
  nextOutputShape,
} from "./shared.js";
import { whoamiOutput } from "./whoami.js";

export const loginOptions = z.object({
  ...globalOptionShape,
  browser: browserOption,
  wait: z
    .boolean()
    .optional()
    .describe(
      "Wait for approval (default in a terminal); --no-wait returns the code for 'login status'",
    )
    .register(describeMeta, {
      negated: "Return the code and URL for 'login status' immediately",
    }),
});

export const loginStatusOptions = z.object({
  ...globalOptionShape,
  interval: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Seconds between checks (default: the wallet's interval)")
    .register(describeMeta, { valueName: "SECONDS" }),
  "max-attempts": z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe("Checks before giving up with E_POLL_TIMEOUT (default: until the code expires)")
    .register(describeMeta, { valueName: "COUNT" }),
});

export const loginStatusOutput = z.object({
  accounts: z.array(z.string()),
  ...networkOutputShape,
  ...nextOutputShape,
});

export const loginOutput = z.union([
  whoamiOutput,
  loginStatusOutput,
  z.object({
    status: z.literal("pending"),
    verification_url: z.string().describe("URL where the user approves the login"),
    user_code: z.string().describe("Code the user checks against the one the wallet shows"),
    expires_at: z.string().describe("When the code expires (ISO 8601)"),
    ...nextOutputShape,
  }),
]);
