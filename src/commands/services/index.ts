import { Cli } from "incur";

import type { WalletCommand } from "../../cli/command.js";
import { servicesListOutput, servicesOptions } from "../../schemas/services.js";
import { globalAlias } from "../../schemas/shared.js";
import { deprecatedAnnotations } from "./deprecated.js";
import { listAnnotations, listCommand, listServices } from "./list.js";
import { searchAnnotations, searchCommand } from "./search.js";
import { showAnnotations, showCommand } from "./show.js";

// Bare `tempo wallet services` lists services. MCP serves the deprecated `services` tool in its
// place for one release; see `deprecatedCommand`.
export default {
  command: Cli.create("services", {
    description: "Browse the MPP service directory",
    options: servicesOptions,
    alias: globalAlias,
    output: servicesListOutput,
    async run({ options }) {
      return listServices({ refresh: options.refresh });
    },
  })
    .command("list", listCommand)
    .command("search", searchCommand)
    .command("show", showCommand),
  annotations: {
    services: deprecatedAnnotations,
    services_list: listAnnotations,
    services_search: searchAnnotations,
    services_show: showAnnotations,
  },
} satisfies WalletCommand;
