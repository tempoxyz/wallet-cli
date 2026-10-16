import type { z } from "incur";

import { readOnly } from "../../cli/command.js";
import { deprecatedServicesArgs, deprecatedServicesOptions } from "../../schemas/services.js";
import { listServices } from "./list.js";
import { searchServices } from "./search.js";
import { showService } from "./show.js";

type DeprecatedContext = {
  args: z.output<typeof deprecatedServicesArgs>;
  options: z.output<typeof deprecatedServicesOptions>;
};

/**
 * The `services` MCP tool from before `services_list`, `services_search`, and `services_show`,
 * served for one release: an id shows that service, and otherwise `search` searches and its
 * absence lists. An id of `list` is no id. `createMcpCommands` gives it `servicesMcpOutput`. The
 * CLI's deprecated forms are rewritten to the subcommands instead; see `normalizeServicesArgs`.
 */
export const deprecatedCommand = {
  description:
    "Deprecated: use services_list, services_search, or services_show. Browse the MPP service directory",
  args: deprecatedServicesArgs,
  options: deprecatedServicesOptions,
  async run({ args, options }: DeprecatedContext) {
    const serviceId = args.serviceId === "list" ? undefined : args.serviceId;
    if (serviceId) return showService({ serviceId, refresh: options.refresh });
    if (options.search) return searchServices({ query: options.search, refresh: options.refresh });
    return listServices({ refresh: options.refresh });
  },
};

export const deprecatedAnnotations = { ...readOnly, openWorldHint: true };
