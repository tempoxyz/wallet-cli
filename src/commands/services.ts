import { version } from "../shared/constants.js";
import { usageError } from "../shared/errors.js";
import { getArray, getRecord, sanitizeText, stringValue } from "../shared/utils.js";

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
    search?: string | undefined;
    serviceId?: string | undefined;
  } = {},
) {
  const services = await fetchServiceEntries();

  if (options.serviceId) {
    const matches = services.filter((item) => item.summary.id === options.serviceId);
    if (matches.length > 1)
      throw usageError(`Service directory lists '${options.serviceId}' more than once`);
    const service = matches[0];
    if (!service)
      throw usageError(`Configuration missing: service '${options.serviceId}' not found`);
    return service.detail;
  }

  const summaries = services.map((service) => service.summary);
  if (options.search)
    return summaries.filter((service) => matchesSearch(service, options.search ?? ""));
  return summaries;
}

export async function fetchServiceList(): Promise<ServiceSummary[]> {
  return (await fetchServiceEntries()).map((service) => service.summary);
}

async function fetchServiceEntries(): Promise<
  { summary: ServiceSummary; detail: ServiceDetail }[]
> {
  const response = await fetch(
    "https://mpp.dev/api/services?x-vercel-protection-bypass=iGDnLnmF0nK6LWloAotUbTo3urEsaIkB",
    { headers: { "user-agent": `wallet-cli/${version}` } },
  );
  if (!response.ok) throw new Error(`Failed to fetch service directory: HTTP ${response.status}`);

  const body = getRecord((await response.json()) as unknown);
  const services = getArray(body.services).map((service) => {
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
  return services.filter((service) => serviceIdPattern.test(service.summary.id));
}

function matchesSearch(service: ServiceSummary, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return serviceSearchFields(service).some((value) => value.toLowerCase().includes(needle));
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
  return {
    method: displayText(endpoint.method),
    path: displayText(endpoint.path),
    description: displayText(endpoint.description),
    payment: {
      intent: displayText(payment.intent),
      amount: displayText(payment.amount),
      decimals: typeof payment.decimals === "number" ? payment.decimals : null,
      unitType: displayText(payment.unitType ?? payment.unit_type) || null,
      description: displayText(payment.description),
      dynamic: typeof payment.dynamic === "boolean" ? payment.dynamic : null,
    },
    docs: displayText(endpoint.docs) || null,
  };
}

function displayText(value: unknown) {
  return sanitizeText(stringValue(value));
}
