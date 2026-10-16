import type { z } from "incur";

import { readOnly } from "../../cli/command.js";
import { servicesListOutput, servicesOptions } from "../../schemas/services.js";
import { globalAlias } from "../../schemas/shared.js";
import { loadServices, markStale, refreshFlag, type ServiceSummary } from "./directory.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type ListContext = { options: z.output<typeof servicesOptions> };

export const listCommand = {
  description: "List every service in the MPP service directory",
  options: servicesOptions,
  alias: globalAlias,
  output: servicesListOutput,
  async run({ options }: ListContext) {
    return listServices({ refresh: options.refresh });
  },
};

export const listAnnotations = { ...readOnly, openWorldHint: true };

export const listDescribe = {
  name: "list",
  about: "List every service in the MPP service directory",
  args: [refreshFlag],
};

export async function listServices(
  options: { refresh?: boolean | undefined } = {},
): Promise<ServiceSummary[]> {
  const { services, staleFetchedAt } = await loadServices(options.refresh);
  return markStale(
    services.map((service) => service.summary),
    staleFetchedAt,
  );
}
