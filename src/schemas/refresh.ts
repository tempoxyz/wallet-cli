import { z } from "incur";

import { browserOption, globalOptionShape, networkOutputShape } from "./shared.js";

export const refreshOptions = z.object({
  ...globalOptionShape,
  browser: browserOption,
});

export const refreshOutput = z.object({
  accounts: z.array(z.string()),
  ...networkOutputShape,
});
