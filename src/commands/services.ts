import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Cli } from "incur";
import { formatUnits } from "viem";

import { readOnly, type WalletCommand } from "../cli/command.js";
import { flag, option, positional } from "../cli/describe.js";
import { servicesArgs, servicesOptions, servicesOutput } from "../schemas/services.js";
import { globalAlias } from "../schemas/shared.js";
import { version } from "../shared/constants.js";
import { httpError, networkError, usageError, walletError } from "../shared/errors.js";
import { getArray, getRecord, sanitizeText, stringValue } from "../shared/utils.js";

export default {
  command: Cli.create("services", {
    description: "Browse the MPP service directory",
    args: servicesArgs,
    options: servicesOptions,
    alias: globalAlias,
    output: servicesOutput,
    async run({ args, options }) {
      if (args.serviceId === "list" && !options.search)
        return fetchServiceList({ refresh: options.refresh });
      return fetchServices({
        refresh: options.refresh,
        search: options.search,
        serviceId: args.serviceId === "list" ? undefined : args.serviceId,
      });
    },
  }),
  annotations: { services: { ...readOnly, openWorldHint: true } },
  describe: {
    name: "services",
    about: "Browse the MPP service directory",
    args: [
      positional("service_id", "Service ID to show details for"),
      option(
        "search",
        "--search",
        "Search by name, id, description, tags, or category; every word must match",
        { valueName: "QUERY" },
      ),
      flag("refresh", "--refresh", "Fetch the service directory instead of using the cached copy"),
    ],
  },
} satisfies WalletCommand;

type ServiceSummary = {
  id: string;
  name: string;
  url?: string | undefined;
  service_url?: string | undefined;
  description?: string | undefined;
  categories: string[];
  tags: string[];
  endpoint_count?: number | undefined;
};

type ServiceDetail = ServiceSummary & {
  docs?: unknown;
  endpoints?: unknown[] | undefined;
};

// Ids select a service, so they are matched raw and must be plain slugs.
const serviceIdPattern = /^[a-z0-9][a-z0-9._-]*$/i;

export async function fetchServices(
  options: {
    refresh?: boolean | undefined;
    search?: string | undefined;
    serviceId?: string | undefined;
  } = {},
) {
  const { services, staleFetchedAt } = await fetchServiceEntries(options.refresh);

  if (options.serviceId) {
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

  const summaries = services.map((service) => service.summary);
  return markStale(
    options.search ? searchServices(summaries, options.search) : summaries,
    staleFetchedAt,
  );
}

export async function fetchServiceList(
  options: { refresh?: boolean | undefined } = {},
): Promise<ServiceSummary[]> {
  const { services, staleFetchedAt } = await fetchServiceEntries(options.refresh);
  return markStale(
    services.map((service) => service.summary),
    staleFetchedAt,
  );
}

// Lists stay plain arrays in CLI output, so their staleness travels beside them for MCP results.
const staleLists = new WeakMap<object, string>();

/** When a service list came from an expired cache, the time that cache was fetched. */
export function staleListFetchedAt(value: unknown) {
  return value && typeof value === "object" ? staleLists.get(value) : undefined;
}

function markStale<value extends object>(list: value, fetchedAt: string | undefined) {
  if (fetchedAt) staleLists.set(list, fetchedAt);
  return list;
}

const serviceDirectoryUrl = "https://mpp.dev/api/services";
const serviceDirectoryTimeout = 10_000;
const serviceDirectoryCacheTtl = 10 * 60_000;
// The directory is ~560KB today; anything far larger is rejected before parsing or caching.
const serviceDirectoryMaxLength = 5 * 1024 * 1024;

async function fetchServiceEntries(refresh = false): Promise<{
  services: { summary: ServiceSummary; detail: ServiceDetail }[];
  staleFetchedAt?: string | undefined;
}> {
  const directory = await loadServiceDirectory(refresh);
  const services = getArray(getRecord(directory.body).services).map((service) => {
    const item = getRecord(service);
    const serviceUrl = displayText(item.serviceUrl ?? item.service_url ?? item.url);
    const summary = {
      id: stringValue(item.id),
      name: displayText(item.name),
      ...(displayText(item.url) ? { url: displayText(item.url) } : {}),
      ...(serviceUrl ? { service_url: serviceUrl } : {}),
      ...(displayText(item.description) ? { description: displayText(item.description) } : {}),
      categories: getArray(item.categories).flatMap((value) =>
        typeof value === "string" ? [sanitizeText(value)] : [],
      ),
      tags: getArray(item.tags).flatMap((value) =>
        typeof value === "string" ? [sanitizeText(value)] : [],
      ),
      ...(typeof item.endpointCount === "number"
        ? { endpoint_count: item.endpointCount }
        : typeof item.endpoint_count === "number"
          ? { endpoint_count: item.endpoint_count }
          : Array.isArray(item.endpoints)
            ? { endpoint_count: item.endpoints.length }
            : {}),
    };
    return {
      summary,
      detail: {
        ...summary,
        docs: serviceDocs(item.docs),
        ...(Array.isArray(item.endpoints)
          ? { endpoints: item.endpoints.map(serviceEndpoint) }
          : {}),
      },
    };
  });
  return {
    services: services.filter((service) => serviceIdPattern.test(service.summary.id)),
    staleFetchedAt: directory.staleFetchedAt,
  };
}

/** Serves a cache younger than the TTL, and falls back to an older one when the fetch fails. */
async function loadServiceDirectory(
  refresh: boolean,
): Promise<{ body: unknown; staleFetchedAt?: string | undefined }> {
  const cached = refresh ? undefined : await readServiceDirectoryCache();
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (cached && age >= 0 && age < serviceDirectoryCacheTtl) return { body: cached.body };

  try {
    const text = await fetchServiceDirectoryText();
    const body = parseServiceDirectory(text);
    await writeServiceDirectoryCache(text);
    return { body };
  } catch (error) {
    if (!cached) throw error;
    const fetchedAt = new Date(cached.fetchedAt).toISOString();
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Warning: ${reason}; using the cached service directory from ${fetchedAt}`);
    return { body: cached.body, staleFetchedAt: fetchedAt };
  }
}

async function fetchServiceDirectoryText() {
  const response = await fetch(serviceDirectoryUrl, {
    headers: { "user-agent": `wallet-cli/${version}` },
    signal: AbortSignal.timeout(serviceDirectoryTimeout),
  }).catch(serviceDirectoryNetworkError);
  if (!response.ok)
    throw httpError(response.status, `Failed to fetch service directory: HTTP ${response.status}`);
  return await response.text().catch(serviceDirectoryNetworkError);
}

/** Parses a directory response, rejecting anything without a `services` list so it is never cached. */
function parseServiceDirectory(text: string) {
  if (text.length > serviceDirectoryMaxLength)
    return serviceDirectoryNetworkError(new Error("response is larger than 5 MB"));
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    return serviceDirectoryNetworkError(error);
  }
  if (!Array.isArray(getRecord(body).services))
    return serviceDirectoryNetworkError(new Error("response has no services list"));
  return body;
}

function serviceDirectoryNetworkError(error: unknown): never {
  const reason =
    error instanceof Error && error.name === "TimeoutError"
      ? `timed out after ${serviceDirectoryTimeout / 1000}s`
      : error instanceof Error
        ? error.message
        : String(error);
  // The directory is a GET, so transport failures are safe to retry.
  throw networkError(`Failed to fetch service directory: ${reason}`, { retryable: true });
}

export function serviceDirectoryCachePath() {
  return join(homedir(), ".tempo", "wallet", "services-cache.json");
}

async function readServiceDirectoryCache() {
  const path = serviceDirectoryCachePath();
  try {
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return { body: parseServiceDirectory(text), fetchedAt: info.mtimeMs };
  } catch {
    // A missing, corrupt, or malformed cache is treated as empty.
    return undefined;
  }
}

async function writeServiceDirectoryCache(text: string) {
  const path = serviceDirectoryCachePath();
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(tempPath, text, { mode: 0o600 });
    await rename(tempPath, path);
  } catch {
    // The cache only saves a fetch, so failing to write it must not fail the command.
    await unlink(tempPath).catch(() => undefined);
  }
}

/** Keeps services matching every query word in some field, exact id or name matches first. */
function searchServices(services: ServiceSummary[], query: string) {
  if (query.length > maxSearchLength)
    throw usageError(`--search accepts at most ${maxSearchLength} characters`);
  const words = [...new Set(searchWords(query))];
  if (words.length > maxSearchWords)
    throw usageError(`--search accepts at most ${maxSearchWords} distinct words`);
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

// Bounds keep search and suggestion work small for any input, including MCP calls.
const maxSearchLength = 256;
const maxSearchWords = 16;
const maxSuggestionIdLength = 64;

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

function serviceDocs(value: unknown) {
  const docs = getRecord(value);
  return {
    homepage: displayText(docs.homepage) || null,
    llmsTxt: displayText(docs.llmsTxt ?? docs.llms_txt) || null,
    openapi: displayText(docs.openapi) || null,
    apiReference: displayText(docs.apiReference ?? docs.api_reference) || null,
  };
}

function serviceEndpoint(value: unknown) {
  const endpoint = getRecord(value);
  const payment = getRecord(endpoint.payment);
  const amount = displayText(payment.amount);
  const decimals = typeof payment.decimals === "number" ? payment.decimals : null;
  return {
    method: displayText(endpoint.method),
    path: displayText(endpoint.path),
    description: displayText(endpoint.description),
    payment: {
      intent: displayText(payment.intent),
      amount,
      decimals,
      price: formatPrice(amount, decimals),
      unitType: displayText(payment.unitType ?? payment.unit_type) || null,
      description: displayText(payment.description),
      dynamic: typeof payment.dynamic === "boolean" ? payment.dynamic : null,
    },
    docs: displayText(endpoint.docs) || null,
  };
}

/** Formats a base-unit amount in whole tokens, e.g. "10000" with 6 decimals as "0.01". */
function formatPrice(amount: string, decimals: number | null) {
  // A uint256 has at most 78 digits; longer amounts are not real prices and would be costly to parse.
  if (!/^\d{1,78}$/.test(amount) || decimals === null) return null;
  // Token decimals fit in a uint8.
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  return formatUnits(BigInt(amount), decimals);
}

function displayText(value: unknown) {
  return sanitizeText(stringValue(value));
}
