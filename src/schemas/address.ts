import { z } from "incur";

import { globalOptionShape, networkOutputShape } from "./shared.js";

export const addressOptions = z.object({
  ...globalOptionShape,
  qr: z
    .boolean()
    .optional()
    .describe("Also show a QR code of the address when output is a terminal"),
});

export const addressOutput = z.object({
  address: z.string().describe("The logged-in wallet"),
  ...networkOutputShape,
});
