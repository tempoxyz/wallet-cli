import { z } from "incur";

import { globalOptionShape, networkOutputShape } from "./shared.js";

export const balanceOptions = z.object({
  ...globalOptionShape,
  token: z
    .string()
    .optional()
    .describe("Token address or symbol to show (default: every token the wallet holds)"),
});

export const balanceOutput = z.object({
  address: z.string().describe("The logged-in wallet"),
  ...networkOutputShape,
  balances: z.array(
    z.object({
      token: z.string().describe("Token address"),
      symbol: z
        .string()
        .nullable()
        .describe("Listed symbol, else the token's own when it is a plain ticker; null otherwise"),
      decimals: z.number(),
      balance: z.string().describe("Balance in token units"),
      verified: z
        .boolean()
        .describe("Whether a token list vouches for the token; an unverified symbol is its own"),
    }),
  ),
});
