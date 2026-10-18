import { File } from "node:buffer";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import type { FormData as UndiciFormData } from "undici";

import { networkError, usageError } from "../shared/errors.js";
import { explicitNetwork } from "../shared/network.js";
import { listedSymbol, resolveTokenAddress } from "../shared/tokens.js";
import { privateKeySigner, requestNetwork } from "./identity.js";
import { isMachPaymentToken } from "./mach.js";
import { fundingSetting, parseMaxSlippageBps } from "./funding-mode.js";
import type { PaymentIntent, RequestOptions } from "./options.js";
import { resolveMaxSpend } from "./spend.js";

export function parseRequestArgs(argv: readonly string[]): RequestOptions {
  const options: Omit<RequestOptions, "url"> = {
    data: [],
    dataUrlencode: [],
    form: [],
    headers: [],
    paymentIntent: "auto",
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }

    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "-s":
      case "--silent":
      case "-v":
      case "--verbose":
      case "-t":
      case "--toon-output":
        break;
      case "--max-spend":
        options.maxSpend = requireValue(argv, ++index, arg);
        break;
      case "--payment-intent":
        options.paymentIntent = paymentIntentValue(requireValue(argv, ++index, arg));
        break;
      case "--mach":
        options.mach = true;
        break;
      case "--funding":
        options.funding = requireValue(argv, ++index, arg);
        break;
      case "--max-funding-spend":
        options.maxFundingSpend = requireValue(argv, ++index, arg);
        break;
      case "--payment-network":
        options.paymentNetwork = requireValue(argv, ++index, arg);
        break;
      case "--max-slippage-bps":
        options.maxSlippageBps = Number(requireValue(argv, ++index, arg));
        break;
      case "--payment-token":
        options.paymentToken = requireValue(argv, ++index, arg);
        break;
      case "--private-key":
        options.privateKey = requireValue(argv, ++index, arg);
        break;
      case "-n":
      case "--network":
        options.network = requireValue(argv, ++index, arg);
        break;
      case "--offline":
        throw networkError("--offline mode enabled; refusing to make network requests");
      case "-i":
      case "--include":
        options.includeHeaders = true;
        break;
      case "-I":
        options.head = true;
        options.includeHeaders = true;
        break;
      case "-L":
      case "--location":
        options.followRedirects = true;
        break;
      case "-G":
      case "--get":
        options.get = true;
        break;
      case "-k":
      case "--insecure":
        options.insecure = true;
        break;
      case "--allow-insecure-payment":
        options.allowInsecurePayment = true;
        break;
      case "--stream":
        options.stream = true;
        break;
      case "--sse":
        options.sse = true;
        break;
      case "--sse-json":
        options.sseJson = true;
        break;
      case "--compressed":
        options.compressed = true;
        break;
      case "-O":
      case "--remote-name":
        options.remoteName = true;
        break;
      case "--no-proxy":
        options.noProxy = true;
        break;
      case "--http2":
        options.requestHttp2 = true;
        break;
      case "--http1.1":
      case "--http1_1":
        options.requestHttp1 = true;
        break;
      case "-X":
      case "--request":
        options.method = requireValue(argv, ++index, arg);
        break;
      case "-H":
      case "--header":
        options.headers.push(requireValue(argv, ++index, arg));
        break;
      case "-o":
      case "--output":
        options.output = requireValue(argv, ++index, arg);
        break;
      case "-m":
      case "--timeout":
        options.maxTime = Number(requireValue(argv, ++index, arg));
        break;
      case "--connect-timeout":
        options.connectTimeout = Number(requireValue(argv, ++index, arg));
        break;
      case "-d":
      case "--data":
        options.data.push(requireValue(argv, ++index, arg));
        break;
      case "--json":
        if (options.toon !== undefined) throw usageError("--json cannot be used with --toon");
        options.json = requireValue(argv, ++index, arg);
        break;
      case "--toon":
        if (options.json !== undefined) throw usageError("--toon cannot be used with --json");
        options.toon = requireValue(argv, ++index, arg);
        break;
      case "--retries":
        options.retries = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "--retry-backoff":
        options.retryBackoffMs = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "--retry-jitter":
        options.retryJitter = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "--max-redirs":
        options.maxRedirs = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
        break;
      case "--retry-http":
        options.retryHttp = requireValue(argv, ++index, arg);
        break;
      case "--retry-after":
        options.retryAfter = true;
        break;
      case "-A":
      case "--user-agent":
        options.userAgent = requireValue(argv, ++index, arg);
        break;
      case "-D":
      case "--dump-header":
        options.dumpHeader = requireValue(argv, ++index, arg);
        break;
      case "-u":
      case "--user":
        options.user = requireValue(argv, ++index, arg);
        break;
      case "--bearer":
        options.bearer = requireValue(argv, ++index, arg);
        break;
      case "--write-meta":
        options.writeMeta = requireValue(argv, ++index, arg);
        break;
      case "--proxy":
        options.proxy = requireValue(argv, ++index, arg);
        break;
      case "-e":
      case "--referer":
        options.referer = requireValue(argv, ++index, arg);
        break;
      case "--data-urlencode":
        options.dataUrlencode.push(requireValue(argv, ++index, arg));
        break;
      case "-F":
      case "--form":
        options.form.push(requireValue(argv, ++index, arg));
        break;
      default:
        throw usageError(`Unsupported request option: ${arg}`);
    }
  }

  if (positionals.length !== 1) throw usageError("URL is required");
  const url = positionals[0];
  if (!url) throw usageError("URL is required");
  const result = { ...options, url };
  validateRequestOptions(result);
  return result;
}

export function validateRequestOptions(options: RequestOptions) {
  validateUrl(options.url);
  options.network = explicitNetwork(options.network)?.name;
  options.maxSpend = resolveMaxSpend(options.maxSpend);
  fundingSetting(options.funding);
  if (options.maxFundingSpend !== undefined && !/^\d+(?:\.\d{1,6})?$/.test(options.maxFundingSpend))
    throw usageError(
      "--max-funding-spend must be a non-negative amount with at most 6 decimal places",
    );
  parseMaxSlippageBps(options.maxSlippageBps);
  privateKeySigner(options);
  if (options.mach) {
    if (options.paymentToken !== undefined && !isMachPaymentToken(options.paymentToken))
      throw usageError("--mach conflicts with --payment-token for another token");
    options.paymentToken = "MACH";
  }
  options.paymentToken = paymentTokenValue(options);
  if (options.paymentIntent !== undefined) paymentIntentValue(options.paymentIntent);
  if (isMachPaymentToken(options.paymentToken) && options.paymentIntent === "session")
    throw usageError("MACH settlement supports charge payments, not sessions");
  for (const [value, flag] of [
    [options.maxTime, "--timeout"],
    [options.connectTimeout, "--connect-timeout"],
  ] as const) {
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value <= 0 || Math.ceil(value * 1000) > 2_147_483_647)
    )
      throw usageError(`${flag} must be positive and at most 2147483.647 seconds`);
  }
  for (const [value, flag] of [
    [options.retries, "--retries"],
    [options.retryBackoffMs, "--retry-backoff"],
    [options.retryJitter, "--retry-jitter"],
    [options.maxRedirs, "--max-redirs"],
  ] as const) {
    if (value !== undefined) parseNonNegativeInteger(String(value), flag);
  }
  if (options.retryHttp !== undefined) {
    const statuses = parseRetryStatuses(options.retryHttp, options.retries);
    if (!options.retryHttp || [...statuses].some((status) => status < 100 || status > 599))
      throw usageError("--retry-http must contain HTTP status codes between 100 and 599");
  }
  if (options.json !== undefined && options.toon !== undefined)
    throw usageError("--json cannot be used with --toon");
  if (options.requestHttp1 && options.requestHttp2)
    throw usageError("--http2 cannot be used with --http1.1");
  if (
    options.form.length &&
    (options.data.length ||
      options.dataUrlencode.length ||
      options.json !== undefined ||
      options.toon !== undefined ||
      options.get)
  )
    throw usageError(
      "--form cannot be used with --data, --data-urlencode, --json, --toon, or --get",
    );
}

function paymentIntentValue(value: string): PaymentIntent {
  if (value === "auto" || value === "session" || value === "charge") return value;
  throw usageError("--payment-intent must be one of: auto, session, charge");
}

/**
 * "MACH" or the selected token's address. A symbol listed on some network is kept until the
 * payment network is known; one no network lists is rejected before any request is sent.
 */
export function paymentTokenValue(options: RequestOptions) {
  const value = options.paymentToken;
  if (value === undefined) return undefined;
  if (value.toLowerCase() === "mach") return "MACH";
  if (options.network === undefined && !/^0x/i.test(value))
    return listedSymbol(value, "payment token");
  return resolveTokenAddress(value, requestNetwork(options), "payment token");
}

function requireValue(argv: readonly string[], index: number, flag: string) {
  const value = argv[index];
  if (!value || (value.startsWith("-") && value !== "-"))
    throw usageError(`${flag} requires a value`);
  return value;
}

export function validateUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw usageError(`Invalid URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw usageError(`Unsupported URL scheme: ${url.protocol.replace(":", "")}`);
}

export function validateMethod(method: string) {
  if (!/^[A-Za-z]+$/.test(method)) throw usageError(`Invalid HTTP method: ${method}`);
}

function parsePositiveInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw usageError(`${flag} must be a positive integer`);
  return parsed;
}

function parseNonNegativeInteger(value: string, flag: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw usageError(`${flag} must be a non-negative integer`);
  return parsed;
}

export async function readDataValue(value: string) {
  if (value === "@-") return readStdin();
  if (value.startsWith("@")) return readFile(value.slice(1), "utf8");
  return value;
}

function readStdin() {
  return new Promise<string>((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(data));
  });
}

export function appendQuery(url: URL, data: string) {
  if (!data) return;
  const prefix = url.search ? "&" : "?";
  url.search = `${url.search}${prefix}${data}`;
}

export function urlEncodeField(value: string) {
  const separator = value.indexOf("=");
  if (separator < 0) return encodeURIComponent(value);
  return `${value.slice(0, separator)}=${encodeURIComponent(value.slice(separator + 1))}`;
}

export async function appendFormField(form: UndiciFormData, field: string) {
  const separator = field.indexOf("=");
  if (separator <= 0) throw usageError(`Invalid form field: ${field}`);
  const name = field.slice(0, separator);
  const value = field.slice(separator + 1);
  if (value.startsWith("@")) {
    const [rawPath, ...attributes] = value.slice(1).split(";");
    if (!rawPath) throw usageError(`Invalid form field: ${field}`);
    const contentType = attributes
      .map((attribute) => attribute.split("="))
      .find(([key]) => key === "type")?.[1];
    const file = new File([await readFile(rawPath)], basename(rawPath), {
      type: contentType ?? "application/octet-stream",
    });
    form.append(name, file, basename(rawPath));
  } else {
    form.append(name, value);
  }
}

const defaultRetryStatuses = new Set([408, 429, 500, 502, 503, 504]);

export function parseRetryStatuses(value: string | undefined, retries: number | undefined) {
  if (!value) return retries ? new Set(defaultRetryStatuses) : new Set<number>();
  return new Set(value.split(",").map((item) => parsePositiveInteger(item.trim(), "--retry-http")));
}

export function parseSimpleToon(value: string) {
  const out: Record<string, string | number | boolean> = {};
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) throw usageError("Failed to decode TOON input");
    const key = trimmed.slice(0, separator).trim();
    const raw = trimmed.slice(separator + 1).trim();
    out[key] =
      raw === "true"
        ? true
        : raw === "false"
          ? false
          : /^-?\d+(\.\d+)?$/.test(raw)
            ? Number(raw)
            : raw;
  }
  return out;
}
