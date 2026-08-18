#!/usr/bin/env node
import { Cli, z } from "incur";

import { executeRequest, type RequestOptions } from "./commands/request.js";
import { version } from "./shared/constants.js";

const args = z.object({
  url: z.string().describe("URL to request"),
});

const options = z.object({
  "dry-run": z.boolean().optional().describe("Show payment challenge without paying"),
  "max-spend": z
    .string()
    .optional()
    .describe("Hard cap for cumulative payment spend (or TEMPO_MAX_SPEND)"),
  "private-key": z.string().optional().describe("Sign payments with an ephemeral private key"),
  network: z
    .string()
    .optional()
    .describe("Network to use (tempo/mainnet or tempo-moderato/testnet)"),
  silent: z.boolean().optional().describe("Compatibility flag; suppresses non-essential output"),
  verbose: z.boolean().optional().describe("Compatibility flag; increases verbosity"),
  "json-output": z.boolean().optional().describe("Emit structured JSON errors"),
  "toon-output": z.boolean().optional().describe("Compatibility flag for compact output mode"),

  request: z.string().optional().describe("Custom request method"),
  include: z.boolean().optional().describe("Include response headers"),
  output: z.string().optional().describe("Write body to file"),
  head: z.boolean().optional().describe("Shorthand for HEAD request"),
  header: z.array(z.string()).default([]).describe("Add custom header"),
  location: z.boolean().optional().describe("Follow redirects"),
  get: z.boolean().optional().describe("Send data as query parameters with GET"),
  timeout: z.coerce.number().optional().describe("Maximum request time in seconds"),
  "connect-timeout": z.coerce.number().optional().describe("Maximum TCP connect time in seconds"),
  data: z.array(z.string()).default([]).describe("POST data; @file reads from file"),
  json: z.string().optional().describe("Send JSON data"),
  toon: z.string().optional().describe("Send simple TOON data as JSON"),
  retries: z.coerce.number().optional().describe("Number of retries"),
  "retry-backoff": z.coerce.number().optional().describe("Initial retry backoff in milliseconds"),
  "retry-jitter": z.coerce.number().optional().describe("Retry jitter percentage"),
  "retry-http": z.string().optional().describe("Retry on comma-separated HTTP status codes"),
  "retry-after": z.boolean().optional().describe("Respect Retry-After headers"),
  insecure: z.boolean().optional().describe("Accept flag for curl compatibility"),
  "user-agent": z.string().optional().describe("Override User-Agent"),
  "dump-header": z.string().optional().describe("Write response headers to file"),
  user: z.string().optional().describe("HTTP Basic auth credentials (user:pass)"),
  stream: z.boolean().optional().describe("Stream response body as it arrives"),
  sse: z.boolean().optional().describe("Treat response as Server-Sent Events and pass through"),
  "sse-json": z
    .boolean()
    .optional()
    .describe("Treat response as SSE and output each event as NDJSON"),
  bearer: z.string().optional().describe("Authorization bearer token"),
  "write-meta": z.string().optional().describe("Write response metadata JSON to file"),
  proxy: z.string().optional().describe("Use an HTTP/HTTPS proxy"),
  noProxy: z.boolean().optional().describe("Disable all proxy use"),
  "max-redirs": z.coerce.number().optional().describe("Maximum redirects when -L is used"),
  http2: z.boolean().optional().describe("Enable HTTP/2"),
  "http1.1": z.boolean().optional().describe("Force HTTP/1.1 only"),
  referer: z.string().optional().describe("Set the Referer header"),
  compressed: z.boolean().optional().describe("Request a compressed response"),
  "remote-name": z.boolean().optional().describe("Save output to a file named after the URL path"),
  "data-urlencode": z.array(z.string()).default([]).describe("URL-encode a data field"),
  form: z.array(z.string()).default([]).describe("Multipart form field (name=value, name=@file)"),
});

const cli = Cli.create("tempo request", {
  version,
  description: "Make HTTP requests with automatic MPP payment",
  args,
  options,
  alias: {
    network: "n",
    silent: "s",
    verbose: "v",
    "json-output": "j",
    "toon-output": "t",
    request: "X",
    include: "i",
    output: "o",
    head: "I",
    header: "H",
    location: "L",
    get: "G",
    timeout: "m",
    data: "d",
    insecure: "k",
    "user-agent": "A",
    "dump-header": "D",
    user: "u",
    referer: "e",
    "remote-name": "O",
    form: "F",
  },
  usage: [{ args: { url: true } }],
  examples: [
    { args: { url: "https://api.example.com/data" }, description: "Make a GET request" },
    {
      args: { url: "https://api.example.com/v1/chat" },
      options: { request: "POST", json: '{"prompt":"hello"}' },
      description: "POST JSON data",
    },
    {
      args: { url: "https://api.example.com/data" },
      options: { header: ["Accept: text/plain"], output: "out.txt" },
      description: "Set a header and write output to a file",
    },
  ],
  async run({ args, options }) {
    await executeRequest(toRequestOptions(args.url, options));
    return undefined;
  },
});

void main();

export default cli;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--describe")) {
    process.stdout.write(`${JSON.stringify(describeRequestCli())}\n`);
    process.exit(0);
  }

  await cli.serve(normalizeIncurArgv(argv));
}

type ParsedOptions = z.infer<typeof options>;

function toRequestOptions(url: string, options: ParsedOptions): RequestOptions {
  return {
    bearer: options.bearer,
    compressed: options.compressed,
    data: options.data,
    dataUrlencode: options["data-urlencode"],
    dumpHeader: options["dump-header"],
    dryRun: options["dry-run"],
    followRedirects: options.location,
    form: options.form,
    get: options.get,
    head: options.head,
    headers: options.header,
    includeHeaders: options.include,
    json: options.json,
    connectTimeout: options["connect-timeout"],
    insecure: options.insecure,
    maxRedirs: options["max-redirs"],
    maxTime: options.timeout,
    method: options.request,
    maxSpend: options["max-spend"],
    network: options.network,
    noProxy: options.noProxy,
    output: options.output,
    privateKey: options["private-key"],
    proxy: options.proxy,
    referer: options.referer,
    remoteName: options["remote-name"],
    requestHttp1: options["http1.1"],
    requestHttp2: options.http2,
    retries: options.retries,
    retryAfter: options["retry-after"],
    retryBackoffMs: options["retry-backoff"],
    retryHttp: options["retry-http"],
    retryJitter: options["retry-jitter"],
    sse: options.sse,
    sseJson: options["sse-json"],
    stream: options.stream,
    toon: options.toon,
    url,
    user: options.user,
    userAgent: options["user-agent"],
    writeMeta: options["write-meta"],
  };
}

function normalizeIncurArgv(argv: readonly string[]) {
  const out: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--json") {
      const value = argv[index + 1];
      if (value !== undefined) {
        // incur reserves exact `--json` as an output-format flag. `tempo request`
        // already uses `--json <body>` for curl/Rust parity, so pass the same
        // option through in `--json=<body>` form, which incur leaves available
        // for the command schema.
        out.push(`--json=${value}`);
        index++;
        continue;
      }
    }
    if (arg === "--no-proxy") {
      // Incur treats --no-foo as boolean negation of --foo. `tempo request`
      // intentionally supports curl's separate --proxy <url> and --no-proxy
      // flags, so route the spelling around Incur's negation parser.
      out.push("--noProxy");
      continue;
    }
    if (arg === "-j" || arg === "--json-output") {
      out.push("--format", "json");
      continue;
    }
    out.push(arg);
  }
  return out;
}

function describeRequestCli() {
  return {
    name: "tempo request",
    about: "Make HTTP requests with automatic MPP payment",
    args: [
      { name: "url", positional: true, value_name: "URL", help: "URL to request" },
      { name: "dry_run", long: "--dry-run", help: "Show payment challenge without paying" },
      {
        name: "max_spend",
        long: "--max-spend",
        value_name: "AMOUNT",
        help: "Hard cap for cumulative payment spend (or TEMPO_MAX_SPEND)",
      },
      {
        name: "private_key",
        long: "--private-key",
        value_name: "HEX",
        help: "Sign payments with an ephemeral private key",
      },
      {
        name: "network",
        short: "-n",
        long: "--network",
        value_name: "NETWORK",
        help: "Network to use",
      },
      { name: "silent", short: "-s", long: "--silent", help: "Suppress non-essential output" },
      { name: "verbose", short: "-v", long: "--verbose", help: "Increase verbosity" },
      {
        name: "json_output",
        short: "-j",
        long: "--json-output",
        help: "Emit structured JSON errors",
      },
      { name: "toon_output", short: "-t", long: "--toon-output", help: "Compact output mode" },
      { name: "offline", long: "--offline", help: "Fail without making network requests" },
      {
        name: "method",
        short: "-X",
        long: "--request",
        value_name: "METHOD",
        help: "Custom request method",
      },
      {
        name: "header",
        short: "-H",
        long: "--header",
        value_name: "HEADER",
        help: "Add custom header",
      },
      { name: "head", short: "-I", help: "Shorthand for HEAD request" },
      { name: "location", short: "-L", long: "--location", help: "Follow redirects" },
      { name: "get", short: "-G", long: "--get", help: "Send data as query parameters" },
      {
        name: "timeout",
        short: "-m",
        long: "--timeout",
        value_name: "SECONDS",
        help: "Maximum request time in seconds",
      },
      {
        name: "connect_timeout",
        long: "--connect-timeout",
        value_name: "SECONDS",
        help: "Maximum TCP connect time in seconds",
      },
      { name: "data", short: "-d", long: "--data", value_name: "DATA", help: "POST data" },
      { name: "json", long: "--json", value_name: "JSON", help: "Send JSON data" },
      { name: "toon", long: "--toon", value_name: "TOON", help: "Send TOON data as JSON" },
      {
        name: "form",
        short: "-F",
        long: "--form",
        value_name: "FIELD",
        help: "Multipart form field",
      },
      {
        name: "data_urlencode",
        long: "--data-urlencode",
        value_name: "DATA",
        help: "URL-encode a data field",
      },
      {
        name: "retries",
        long: "--retries",
        value_name: "N",
        help: "Number of retries",
      },
      {
        name: "retry_backoff",
        long: "--retry-backoff",
        value_name: "MILLIS",
        help: "Initial retry backoff in milliseconds",
      },
      {
        name: "retry_jitter",
        long: "--retry-jitter",
        value_name: "PCT",
        help: "Retry jitter percentage",
      },
      {
        name: "retry_http",
        long: "--retry-http",
        value_name: "CODES",
        help: "Retry on comma-separated HTTP status codes",
      },
      { name: "retry_after", long: "--retry-after", help: "Respect Retry-After headers" },
      { name: "insecure", short: "-k", long: "--insecure", help: "Allow insecure TLS" },
      {
        name: "user_agent",
        short: "-A",
        long: "--user-agent",
        value_name: "STRING",
        help: "Override User-Agent",
      },
      {
        name: "dump_header",
        short: "-D",
        long: "--dump-header",
        value_name: "FILE",
        help: "Write response headers to file",
      },
      {
        name: "user",
        short: "-u",
        long: "--user",
        value_name: "USER:PASS",
        help: "HTTP Basic auth credentials",
      },
      { name: "stream", long: "--stream", help: "Stream response body" },
      { name: "sse", long: "--sse", help: "Treat response as Server-Sent Events" },
      { name: "sse_json", long: "--sse-json", help: "Output SSE events as NDJSON" },
      { name: "bearer", long: "--bearer", value_name: "TOKEN", help: "Authorization bearer token" },
      {
        name: "write_meta",
        long: "--write-meta",
        value_name: "FILE",
        help: "Write response metadata JSON to file",
      },
      { name: "proxy", long: "--proxy", value_name: "URL", help: "Use an HTTP/HTTPS proxy" },
      { name: "no_proxy", long: "--no-proxy", help: "Disable all proxy use" },
      {
        name: "max_redirs",
        long: "--max-redirs",
        value_name: "N",
        help: "Maximum redirects when -L is used",
      },
      { name: "http2", long: "--http2", help: "Enable HTTP/2" },
      { name: "http1_1", long: "--http1.1", help: "Force HTTP/1.1 only" },
      {
        name: "referer",
        short: "-e",
        long: "--referer",
        value_name: "URL",
        help: "Set the Referer header",
      },
      { name: "compressed", long: "--compressed", help: "Request a compressed response" },
      {
        name: "remote_name",
        short: "-O",
        long: "--remote-name",
        help: "Save output using the URL filename",
      },
      { name: "include", short: "-i", long: "--include", help: "Include response headers" },
      {
        name: "output",
        short: "-o",
        long: "--output",
        value_name: "FILE",
        help: "Write output to file",
      },
    ],
  };
}
