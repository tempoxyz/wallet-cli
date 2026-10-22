import { setTimeout as sleep } from "node:timers/promises";

import { Errors } from "incur";
import {
  Agent,
  EnvHttpProxyAgent,
  type Dispatcher,
  fetch as undiciFetch,
  FormData as UndiciFormData,
  ProxyAgent,
} from "undici";

import { version } from "../shared/constants.js";
import { networkError, usageError } from "../shared/errors.js";
import {
  appendFormField,
  appendQuery,
  parseRetryStatuses,
  parseSimpleToon,
  readDataValue,
  urlEncodeField,
  validateMethod,
  validateUrl,
} from "./args.js";
import type { RequestOptions } from "./options.js";

export type FetchPlan = {
  init: RequestInitWithDispatcher;
  url: string;
};

export type RequestInitWithDispatcher = RequestInit & {
  dispatcher?: Dispatcher | undefined;
};

export async function buildFetchRequest(options: RequestOptions) {
  validateUrl(options.url);
  const url = new URL(options.url);
  const headers = new Headers();
  let body: BodyInit | undefined;
  let method = options.method ?? (options.head ? "HEAD" : undefined);

  headers.set("user-agent", `tempo/${version}`);
  if (options.userAgent) headers.set("user-agent", options.userAgent);
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  if (options.user)
    headers.set("authorization", `Basic ${Buffer.from(options.user).toString("base64")}`);
  if (options.referer) headers.set("referer", options.referer);
  if (options.compressed) headers.set("accept-encoding", "gzip, deflate, br");

  for (const header of options.headers) {
    const separator = header.indexOf(":");
    if (separator <= 0) throw usageError(`Invalid header: ${header}`);
    headers.set(header.slice(0, separator).trim(), header.slice(separator + 1).trim());
  }

  // Negotiate before the initial probe: some servers only offer the requested intent.
  if (!headers.has("accept-payment")) {
    if (options.paymentIntent !== "auto")
      headers.set("accept-payment", `tempo/${options.paymentIntent}`);
  }

  if (options.json !== undefined) {
    try {
      JSON.parse(options.json);
    } catch (error) {
      throw usageError(
        `Invalid JSON passed to --json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    body = options.json;
    headers.set("content-type", headers.get("content-type") ?? "application/json");
    method ??= "POST";
  } else if (options.toon !== undefined) {
    // Minimal TOON input compatibility for common "key: value" agent prompts.
    body = JSON.stringify(parseSimpleToon(options.toon));
    headers.set("content-type", headers.get("content-type") ?? "application/json");
    method ??= "POST";
  } else if (options.form.length > 0) {
    const form = new UndiciFormData();
    for (const field of options.form) await appendFormField(form, field);
    body = form as unknown as BodyInit;
    method ??= "POST";
  } else if (options.data.length > 0 || options.dataUrlencode.length > 0) {
    const data = [
      ...(await Promise.all(options.data.map(readDataValue))),
      ...options.dataUrlencode.map(urlEncodeField),
    ].join("&");
    if (options.get) appendQuery(url, data);
    else {
      body = data;
      headers.set(
        "content-type",
        headers.get("content-type") ?? "application/x-www-form-urlencoded",
      );
      method ??= "POST";
    }
  }

  method ??= "GET";
  validateMethod(method);

  const init: RequestInitWithDispatcher = {
    headers,
    method,
    redirect: "manual",
  };
  if (body !== undefined) init.body = body;
  if (options.maxTime) init.signal = AbortSignal.timeout(Math.ceil(options.maxTime * 1000));
  init.dispatcher = buildDispatcher(options);

  return { init, url: url.toString() };
}

export async function fetchWithRetries(
  request: FetchPlan,
  options: RequestOptions,
  fetchImpl: typeof fetch = undiciFetch as unknown as typeof fetch,
) {
  const retryStatuses = parseRetryStatuses(options.retryHttp, options.retries);
  const attempts = (options.retries ?? 0) + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await fetchWithRedirects(request, options, fetchImpl);
      const { response } = result;
      if (attempt + 1 < attempts && retryStatuses.has(response.status)) {
        await response.body?.cancel();
        await waitBeforeRetry(response, options, attempt, request.init.signal);
        continue;
      }
      return result;
    } catch (error) {
      lastError = error;
      if (request.init.signal?.aborted || attempt + 1 >= attempts) break;
      try {
        await waitBeforeRetry(undefined, options, attempt, request.init.signal);
      } catch (error) {
        lastError = error;
        break;
      }
    }
  }

  // Redirect-limit refusals keep their code.
  if (lastError instanceof Errors.IncurError) throw lastError;
  throw transportError(lastError, request.init.method ?? "GET");
}

export async function fetchWithRedirects(
  request: FetchPlan,
  options: RequestOptions,
  fetchImpl: typeof fetch,
  sameOriginOnly = false,
) {
  let current = { init: cloneRequestInit(request.init), url: request.url };
  const limit = options.followRedirects ? (options.maxRedirs ?? 10) : 0;

  for (let redirects = 0; ; redirects++) {
    const response = await fetchImpl(current.url, cloneRequestInit(current.init));
    if (!options.followRedirects || !isRedirectStatus(response.status))
      return { request: current, response };

    const location = response.headers.get("location");
    if (!location) return { request: current, response };
    if (redirects >= limit) throw networkError(`Too many redirects: exceeded ${limit}`);

    const nextUrl = new URL(location, current.url);
    if (sameOriginOnly && nextUrl.origin !== new URL(current.url).origin)
      throw networkError("Refusing to forward a payment credential to another origin");

    current = redirectRequest(current, response.status, nextUrl.toString());
  }
}

function redirectRequest(request: FetchPlan, status: number, location: string): FetchPlan {
  const nextUrl = new URL(location, request.url);
  const init = cloneRequestInit(request.init);
  const headers = new Headers(init.headers);
  const method = init.method?.toUpperCase() ?? "GET";

  if (new URL(request.url).origin !== nextUrl.origin) {
    headers.delete("authorization");
    headers.delete("cookie");
    headers.delete("proxy-authorization");
  }

  if (
    (status === 301 || status === 302 || status === 303) &&
    method !== "GET" &&
    method !== "HEAD"
  ) {
    init.method = "GET";
    delete init.body;
    headers.delete("content-length");
    headers.delete("content-type");
  }

  init.headers = headers;
  return { init, url: nextUrl.toString() };
}

function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export const replaySafeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

// Rerunning the command resends the original method, so only safe methods are retryable.
function transportError(error: unknown, method: string) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = method.toUpperCase();
  if (replaySafeMethods.has(normalized)) return networkError(message, { retryable: true });
  return networkError(
    `${message}. The ${normalized} request may have reached the server; check before retrying.`,
  );
}

export function responseBodyNetworkError(method: string) {
  return (error: unknown): never => {
    throw transportError(error, method);
  };
}

export function cloneRequestInit(init: RequestInitWithDispatcher): RequestInitWithDispatcher {
  const out: RequestInitWithDispatcher = { headers: new Headers(init.headers) };
  if (init.method !== undefined) out.method = init.method;
  if (init.redirect !== undefined) out.redirect = init.redirect;
  if (init.body !== undefined && init.body !== null) out.body = init.body;
  if (init.signal !== undefined && init.signal !== null) out.signal = init.signal;
  if (init.dispatcher !== undefined) out.dispatcher = init.dispatcher;
  return out;
}

function buildDispatcher(options: RequestOptions): Dispatcher {
  const connect = {
    ...(options.connectTimeout ? { timeout: options.connectTimeout * 1000 } : {}),
    ...(options.insecure ? { rejectUnauthorized: false } : {}),
    ...(options.requestHttp2 ? { allowH2: true, preferH2: true } : {}),
  };
  const agentOptions = {
    ...(options.connectTimeout ? { connectTimeout: options.connectTimeout * 1000 } : {}),
    ...(options.requestHttp1 ? { allowH2: false } : {}),
    ...(options.requestHttp2 ? { allowH2: true } : {}),
    ...(Object.keys(connect).length > 0 ? { connect } : {}),
  };

  if (options.proxy && !options.noProxy)
    return new ProxyAgent({ ...agentOptions, uri: options.proxy });
  if (options.noProxy) return new Agent(agentOptions);
  if (isLoopbackUrl(options.url)) return new Agent(agentOptions);
  return new EnvHttpProxyAgent(agentOptions);
}

function isLoopbackUrl(value: string) {
  const host = new URL(value).hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

async function waitBeforeRetry(
  response: Response | undefined,
  options: RequestOptions,
  attempt: number,
  signal: AbortSignal | null | undefined,
) {
  const retryAfter =
    response && (options.retryAfter || options.retries !== undefined)
      ? retryAfterMs(response.headers.get("retry-after"))
      : undefined;
  const base = options.retryBackoffMs ?? 250;
  const exponential = Math.min(base * 2 ** attempt, 10_000);
  const jitter = options.retryJitter
    ? Math.floor(exponential * ((Math.random() * options.retryJitter) / 100))
    : 0;
  await sleep(retryAfter ?? exponential + jitter, undefined, { signal: signal ?? undefined });
}

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}
