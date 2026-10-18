import { Cli } from "incur";

import type { WalletCommand } from "../../cli/command.js";
import { fundingListOptions, fundingListOutput } from "../../schemas/funding.js";
import { cliGlobals, globalAlias } from "../../schemas/shared.js";
import { listAnnotations, listCommand, listFunding } from "./list.js";
import { recoverAnnotations, recoverCommand } from "./recover.js";

const about = "Inspect and reconcile cross-chain funding for paid requests";

// Bare `tempo wallet funding` lists funding.
export default {
  command: Cli.create("funding", {
    description: about,
    globals: cliGlobals,
    options: fundingListOptions,
    alias: globalAlias,
    output: fundingListOutput,
    async run({ globals }) {
      return listFunding(globals.network);
    },
  })
    .command("list", listCommand)
    .command("recover", recoverCommand),
  annotations: {
    funding: listAnnotations,
    funding_list: listAnnotations,
    funding_recover: recoverAnnotations,
  },
} satisfies WalletCommand;
