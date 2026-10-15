import { z } from "incur";

import { globalOptionShape } from "./shared.js";

export const servicesArgs = z.object({
  serviceId: z.string().optional().describe("Service ID to show details for"),
});

export const servicesOptions = z.object({
  ...globalOptionShape,
  search: z
    .string()
    .optional()
    .describe("Search by name, id, description, tags, or category; every word must match"),
  refresh: z
    .boolean()
    .optional()
    .describe("Fetch the service directory instead of using the cached copy"),
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

export const servicesOutput = z.union([z.array(serviceOutput), serviceDetailOutput]);

export const servicesListOutput = z.array(serviceOutput);

export const servicesMcpOutput = z
  .object({
    ...serviceDetailOutput.partial().shape,
    services: z.array(serviceOutput).optional(),
  })
  .refine(
    (value) => value.services !== undefined || (value.id !== undefined && value.name !== undefined),
    "Expected a services list or service details",
  );
