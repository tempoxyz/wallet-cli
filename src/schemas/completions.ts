import { z } from "incur";

import { supportedShells } from "../completions.js";

export const completionsArgs = z.object({
  shell: z.enum(supportedShells).optional(),
});

export const completionsOutput = z.object({
  supported_shells: z.array(z.string()),
});
