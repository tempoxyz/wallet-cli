import type { z } from "incur";

import { readOnly } from "../../cli/command.js";
import { positional } from "../../cli/describe.js";
import { servicesListOutput, servicesOptions, servicesSearchArgs } from "../../schemas/services.js";
import { globalAlias } from "../../schemas/shared.js";
import { usageError } from "../../shared/errors.js";
import { loadServices, markStale, refreshFlag, type ServiceSummary } from "./directory.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type SearchContext = {
  args: z.output<typeof servicesSearchArgs>;
  options: z.output<typeof servicesOptions>;
};

export const searchCommand = {
  description: "Search services by name, id, description, tags, or category; every word must match",
  args: servicesSearchArgs,
  options: servicesOptions,
  alias: globalAlias,
  output: servicesListOutput,
  async run({ args, options }: SearchContext) {
    return searchServices({ query: args.query, refresh: options.refresh });
  },
};

export const searchAnnotations = { ...readOnly, openWorldHint: true };

export const searchDescribe = {
  name: "search",
  about: "Search services by name, id, description, tags, or category; every word must match",
  args: [
    positional("query", "Words to match in name, id, description, tags, or category"),
    refreshFlag,
  ],
};

/** The services matching every query word in some field, exact id or name matches first. */
export async function searchServices(options: {
  query: string;
  refresh?: boolean | undefined;
}): Promise<ServiceSummary[]> {
  const { services, staleFetchedAt } = await loadServices(options.refresh);
  return markStale(
    matchServices(
      services.map((service) => service.summary),
      options.query,
    ),
    staleFetchedAt,
  );
}

function matchServices(services: ServiceSummary[], query: string) {
  if (query.length > maxSearchLength)
    throw usageError(`Search queries accept at most ${maxSearchLength} characters`);
  const words = [...new Set(searchWords(query))];
  if (words.length > maxSearchWords)
    throw usageError(`Search queries accept at most ${maxSearchWords} distinct words`);
  if (!words.length) return services;

  const matches = services.filter((service) => {
    const fields = serviceSearchFields(service).map((value) => value.toLowerCase());
    return words.every((word) => fields.some((field) => field.includes(word)));
  });
  const phrase = words.join(" ");
  const isExact = (service: ServiceSummary) =>
    [service.id, service.name].some((value) => searchWords(value).join(" ") === phrase);
  return [...matches.filter(isExact), ...matches.filter((service) => !isExact(service))];
}

// Bounds keep search work small for any input, including MCP calls.
const maxSearchLength = 256;
const maxSearchWords = 16;

function searchWords(value: string) {
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);
}

function serviceSearchFields(service: ServiceSummary) {
  return [
    service.id,
    service.name,
    service.description ?? "",
    ...service.categories,
    ...service.tags,
  ];
}
