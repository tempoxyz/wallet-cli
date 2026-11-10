import type { RetiredFlag } from "../cli/argv.js";

/** Refuse old clients instead of silently falling back to a token payment or funding flow. */
export const creditsFlag: RetiredFlag = {
  flag: "--credits",
  mcp: true,
  replacement: () => ({
    message: "--credits was removed. Use on-chain token balances and payments.",
  }),
};
