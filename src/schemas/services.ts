import { z } from "incur";

import { globalOptionShape } from "./shared.js";

const refresh = z
  .boolean()
  .optional()
  .describe("Fetch the service directory instead of using the cached copy");

/** The options of bare `services` and each of its subcommands. */
export const servicesOptions = z.object({ ...globalOptionShape, refresh });

export const servicesSearchArgs = z.object({
  query: z.string().describe("Words to match in name, id, description, tags, or category"),
});

export const servicesShowArgs = z.object({
  serviceId: z.string().describe("Service ID to show details for"),
});

export const serviceOutput = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  service_url: z.string().optional(),
  description: z.string().optional(),
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  endpoint_count: z.number().optional(),
});

export const serviceDetailOutput = serviceOutput.extend({
  docs: z.unknown().optional(),
  endpoints: z.array(z.unknown()).optional(),
  stale: z.boolean().optional(),
  fetched_at: z.string().optional(),
});

export const servicesListOutput = z.array(serviceOutput);

/** MCP results must be objects, so `services_list` and `services_search` wrap their list. */
export const servicesListMcpOutput = z.object({
  services: z.array(serviceOutput),
  stale: z.boolean().optional(),
  fetched_at: z.string().optional(),
});

/** The deprecated `services` MCP tool: an id shows that service; otherwise it lists or searches. */
export const deprecatedServicesArgs = z.object({
  serviceId: z.string().optional().describe("Service ID to show details for"),
});

export const deprecatedServicesOptions = z.object({
  ...globalOptionShape,
  search: z
    .string()
    .optional()
    .describe("Search by name, id, description, tags, or category; every word must match"),
  refresh,
});

/** The deprecated `services` tool's result: a wrapped list, or one service's details. */
export const servicesMcpOutput = z
  .object({
    ...serviceDetailOutput.partial().shape,
    services: z.array(serviceOutput).optional(),
  })
  .refine(
    (value) => value.services !== undefined || (value.id !== undefined && value.name !== undefined),
    "Expected a services list or service details",
  );
