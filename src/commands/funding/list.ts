import type { z } from "incur";

import { readOnly } from "../../cli/command.js";
import { fundingListOptions, fundingListOutput } from "../../schemas/funding.js";
import { globalAlias, type cliGlobals } from "../../schemas/shared.js";
import { networkFields, resolveNetwork } from "../../shared/network.js";
import { fundingAttempts, fundingItem, operationStore } from "./records.js";

type ListContext = {
  globals: z.output<typeof cliGlobals>;
  options: z.output<typeof fundingListOptions>;
};

export const listCommand = {
  description: "List cross-chain funding that has not been paid with",
  options: fundingListOptions,
  alias: globalAlias,
  output: fundingListOutput,
  async run({ globals }: ListContext) {
    return listFunding(globals.network);
  },
};

export const listAnnotations = { ...readOnly, openWorldHint: false };

/** Saved funding attempts on the network, oldest first, from local state only. */
export async function listFunding(networkFlag: string | undefined) {
  const network = await resolveNetwork(networkFlag);
  const store = operationStore();
  const operations = await Promise.all(
    (await fundingAttempts(network.chainId)).map(async (attempt) =>
      fundingItem(attempt, await store.get(attempt.attemptId)),
    ),
  );
  return { ...networkFields(network.chainId), operations, total: operations.length };
}
