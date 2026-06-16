import { version } from "../shared/constants.js";
import { usageError } from "../shared/errors.js";
import { getArray, getRecord, stringValue } from "../shared/utils.js";

type ServiceSummary = {
  id: string;
  name: string;
  url?: string | undefined;
  service_url?: string | undefined;
  supportsCredits: boolean;
  description?: string | undefined;
  categories: string[];
  tags: string[];
  endpoint_count?: number | undefined;
};

type ServiceDetail = ServiceSummary & {
  docs?: unknown;
  endpoints?: unknown[] | undefined;
};

export async function fetchServices(
  options: {
    search?: string | undefined;
    serviceId?: string | undefined;
  } = {},
) {
  const services = await fetchServiceEntries();

  if (options.serviceId) {
    const service = services.find((item) => item.summary.id === options.serviceId);
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
    const serviceUrl = stringValue(item.serviceUrl ?? item.service_url ?? item.url);
    const summary = {
      id: stringValue(item.id),
      name: stringValue(item.name),
      ...(stringValue(item.url) ? { url: stringValue(item.url) } : {}),
      ...(serviceUrl ? { service_url: serviceUrl } : {}),
      supportsCredits: supportsCredits(serviceUrl),
      ...(stringValue(item.description) ? { description: stringValue(item.description) } : {}),
      categories: getArray(item.categories).flatMap((value) =>
        typeof value === "string" ? [value] : [],
      ),
      tags: getArray(item.tags).flatMap((value) => (typeof value === "string" ? [value] : [])),
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
  return services;
}

function supportsCredits(serviceUrl: string) {
  return new URL(serviceUrl).hostname.endsWith(".mpp.tempo.xyz");
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
    homepage: stringValue(docs.homepage) || null,
    llmsTxt: stringValue(docs.llmsTxt ?? docs.llms_txt) || null,
    openapi: stringValue(docs.openapi) || null,
    apiReference: stringValue(docs.apiReference ?? docs.api_reference) || null,
  };
}

function serviceEndpoint(value: unknown) {
  const endpoint = getRecord(value);
  const payment = getRecord(endpoint.payment);
  return {
    method: stringValue(endpoint.method),
    path: stringValue(endpoint.path),
    description: stringValue(endpoint.description),
    payment: {
      intent: stringValue(payment.intent),
      amount: stringValue(payment.amount),
      decimals: typeof payment.decimals === "number" ? payment.decimals : null,
      unitType: payment.unitType ?? payment.unit_type ?? null,
      description: stringValue(payment.description),
      dynamic: payment.dynamic ?? null,
    },
    docs: stringValue(endpoint.docs) || null,
  };
}
