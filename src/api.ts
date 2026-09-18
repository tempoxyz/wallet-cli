import { Cli, Fetch, Openapi } from "incur";

import { version } from "./shared/constants.js";

type ApiOptions = {
  apiKey?: string | undefined;
  url?: string | undefined;
  routes?: boolean | undefined;
};

/** Creates commands from the same hosted OpenAPI schema used by Tapimo. */
export async function createApiCli(options: ApiOptions = {}) {
  const url = new URL(options.url ?? process.env.TEMPO_API_URL ?? "https://api.tempo.xyz");
  const apiKey = options.apiKey ?? process.env.TEMPO_API_KEY;
  const spec = await Openapi.resolve(new URL("openapi.json", `${url.href.replace(/\/$/, "")}/`));
  const prefix = options.routes ? "/v1/routes" : "";

  // Strip the routing namespace only for discovery; the request source restores it on the wire.
  const openapi = options.routes
    ? {
        ...spec,
        paths: Object.fromEntries(
          Object.entries(spec.paths ?? {})
            .filter(([path]) => path.startsWith(`${prefix}/`))
            .map(([path, value]) => [path.slice(prefix.length), value]),
        ),
      }
    : spec;
  url.pathname = `${url.pathname.replace(/\/$/, "")}${prefix}`;

  return Cli.create(options.routes ? "tempo routes" : "tempo api", {
    version,
    description: options.routes ? "Tempo asset routing API" : "Tempo API commands",
    fetch: Fetch.fromRequest(url, {
      headers: apiKey ? { "tempo-api-key": apiKey } : {},
      redirect: "error",
    }),
    openapi,
    openapiConfig: { mode: "namespace" },
    mcp: {
      instructions:
        "Commands call the hosted Tempo API. Use TEMPO_API_KEY or the generated authentication options for authenticated endpoints. List endpoints paginate with cursor/nextCursor.",
      tools: { exclude: ["admin_*", "gecko_*", "v1_auth_*"] },
    },
  });
}

/** Runs an API extension, keeping version checks independent of API availability. */
export async function serveApi(routes = false) {
  try {
    const argv = process.argv.slice(2);
    if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
      process.stdout.write(`${version}\n`);
      return;
    }
    const cli = await createApiCli({ routes });
    await cli.serve(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
