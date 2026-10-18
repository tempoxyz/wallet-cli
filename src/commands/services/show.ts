import type { z } from "incur";

import { readOnly } from "../../cli/command.js";
import { serviceDetailOutput, servicesOptions, servicesShowArgs } from "../../schemas/services.js";
import { globalAlias } from "../../schemas/shared.js";
import { usageError, walletError } from "../../shared/errors.js";
import { loadServices } from "./directory.js";

// The definition is declared apart from the group's `.command()`, so its run context is typed here.
type ShowContext = {
  args: z.output<typeof servicesShowArgs>;
  options: z.output<typeof servicesOptions>;
};

export const showCommand = {
  description: "Show a service's endpoints, prices, and docs",
  args: servicesShowArgs,
  options: servicesOptions,
  alias: globalAlias,
  output: serviceDetailOutput,
  async run({ args, options }: ShowContext) {
    return showService({ serviceId: args.serviceId, refresh: options.refresh });
  },
};

export const showAnnotations = { ...readOnly, openWorldHint: true };

/** The details of the service `serviceId` names; an unknown id suggests up to 3 close ones. */
export async function showService(options: { serviceId: string; refresh?: boolean | undefined }) {
  const { services, staleFetchedAt } = await loadServices(options.refresh);
  const matches = services.filter((item) => item.summary.id === options.serviceId);
  if (matches.length > 1)
    throw usageError(`Service directory lists '${options.serviceId}' more than once`);
  const service = matches[0];
  if (!service) {
    const suggestions = closestServiceIds(
      services.map((item) => item.summary.id),
      options.serviceId,
    );
    throw walletError({
      code: "E_NOT_FOUND",
      message: `service '${options.serviceId}' not found${
        suggestions.length ? `; did you mean: ${suggestions.join(", ")}?` : ""
      }`,
    });
  }
  return staleFetchedAt
    ? { ...service.detail, stale: true, fetched_at: staleFetchedAt }
    : service.detail;
}

// Bounds keep suggestion work small for any input, including MCP calls.
const maxSuggestionIdLength = 64;

/** Returns up to 3 ids sharing a prefix with the query, then containing it, then a few edits away. */
function closestServiceIds(ids: string[], query: string) {
  const needle = query.toLowerCase();
  if (needle.length > maxSuggestionIdLength) return [];
  const maxDistance = Math.max(1, Math.floor(needle.length / 4));
  return ids
    .flatMap((id) => {
      const value = id.toLowerCase();
      if (value.length > maxSuggestionIdLength) return [];
      if (value.startsWith(needle) || needle.startsWith(value)) return [{ id, rank: 0 }];
      if (value.includes(needle) || needle.includes(value)) return [{ id, rank: 1 }];
      if (Math.abs(value.length - needle.length) > maxDistance) return [];
      const distance = editDistance(value, needle);
      return distance <= maxDistance ? [{ id, rank: 1 + distance }] : [];
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((match) => match.id);
}

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length] ?? 0;
}
