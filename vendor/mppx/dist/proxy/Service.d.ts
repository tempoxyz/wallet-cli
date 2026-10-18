/** A proxied upstream service with route definitions and optional request/response hooks. */
export type Service = {
    /** Base URL of the upstream service (e.g. `'https://api.openai.com'`). */
    baseUrl: string;
    /** Free-form service categories for discovery metadata. */
    categories?: string[] | undefined;
    /** Short description of the service. */
    description?: string | undefined;
    /** Structured service documentation links for discovery metadata. */
    docs?: Docs | undefined;
    /** Unique identifier used as the URL prefix (e.g. `'openai'` → `/{id}/...`). */
    id: string;
    /** Handles failed upstream attempts before the proxy returns a response. Retries do not re-verify payment. */
    onUpstreamError?: UpstreamErrorHandler | undefined;
    /** Hook to modify the upstream request before sending (e.g. inject auth headers). */
    rewriteRequest?: ((req: Request, ctx: Context) => Request | Promise<Request>) | undefined;
    /** Hook to modify the upstream response before returning to the client. */
    rewriteResponse?: ((res: Response, ctx: Context) => Response | Promise<Response>) | undefined;
    /** Map of route patterns to endpoint handlers. */
    routes: EndpointMap;
    /** Human-readable title for the service (e.g. `'OpenAI'`). */
    title?: string | undefined;
};
export type Docs = {
    apiReference?: string | undefined;
    homepage?: string | undefined;
    llms?: string | undefined;
};
/**
 * An endpoint definition.
 *
 * - `IntentHandler` — payment required, calls the handler to issue a 402 challenge or verify payment.
 * - `{ pay, options }` — payment required with per-endpoint config overrides.
 * - `true` — free passthrough, no payment required, rewriteRequest is applied.
 */
export type Endpoint = IntentHandler | {
    pay: IntentHandler;
    options: EndpointOptions;
} | true;
/** Map of `"METHOD /pattern"` keys to endpoint definitions. */
export type EndpointMap<routes extends string = string> = Partial<Record<routes, Endpoint>> & Record<string & {}, Endpoint>;
/** Per-endpoint configuration overrides (e.g. `{ apiKey: 'sk-...' }`). */
export type EndpointOptions = {
    [key: string]: unknown;
};
/** A function that handles the mppx payment flow for a request. */
export type IntentHandler = (input: Request) => Promise<IntentResult>;
/** Result of an intent handler — either a 402 challenge or a 200 with receipt attachment. */
export type IntentResult = {
    challenge: Response;
    status: 402;
} | {
    status: 200;
    withReceipt: <response>(response: response) => response;
};
/** Context passed to `rewriteRequest`/`rewriteResponse` hooks, including any per-endpoint options. */
export type Context = {
    request: Request;
    service: Service;
    upstreamPath: string;
} & EndpointOptions;
/** Context passed to an upstream error handler after a failed proxy attempt. */
export type UpstreamErrorContext = Context & {
    /** One-based upstream attempt number. */
    attempt: number;
    /** Error thrown while preparing or sending the request. Undefined for HTTP error responses. */
    error: unknown | undefined;
    /** Non-2xx upstream response. Undefined when the attempt threw. */
    response: Response | undefined;
    /** Rewritten request sent to the upstream service. */
    upstreamRequest: Request;
};
/** Action returned by an upstream error handler. */
export type UpstreamErrorAction = {
    /** Wait this many milliseconds before retrying. */
    delay?: number | undefined;
    retry: true;
} | {
    /** Optional response to return instead of the original failure. */
    response?: Response | undefined;
    retry: false;
};
/**
 * Handles a non-2xx upstream response or thrown request error.
 *
 * This hook runs before the response is returned. It cannot observe failures
 * from a streaming body after response headers have been sent.
 */
export type UpstreamErrorHandler<options = unknown> = (context: UpstreamErrorContext & Partial<Omit<options & {}, 'onUpstreamError' | 'routes'>>) => UpstreamErrorAction | Promise<UpstreamErrorAction>;
export type From<options extends {
    routes: string;
}> = {
    routes: EndpointMap<options['routes']>;
} & Omit<options, 'onUpstreamError' | 'routes'> & {
    onUpstreamError?: UpstreamErrorHandler<options> | undefined;
};
/**
 * Creates a service definition.
 *
 * @example
 * ```ts
 * Service.from('my-api', {
 *   baseUrl: 'https://api.example.com',
 *   bearer: 'sk-...',
 *   routes: {
 *     'POST /v1/generate': mppx.charge({ amount: '0.01' }),
 *     'GET /v1/status': true,
 *   },
 * })
 * ```
 */
export declare function from<options = unknown>(id: string, config: from.Config<options>): Service;
export declare namespace from {
    type Config<options = unknown> = {
        /** Base URL of the upstream service. */
        baseUrl: string;
        /** Shorthand: inject `Authorization: Bearer {token}` header. */
        bearer?: string | undefined;
        /** Free-form service categories for discovery metadata. */
        categories?: string[] | undefined;
        /** Short description of the service. */
        description?: string | undefined;
        /** Structured service documentation links for discovery metadata. */
        docs?: Docs | undefined;
        /** Shorthand: inject custom headers. */
        headers?: Record<string, string> | undefined;
        /** Documentation URL for the service. String for a static base URL, or a function receiving an optional endpoint pattern. */
        docsLlmsUrl?: string | ((options: {
            route?: string | undefined;
        }) => string | undefined) | undefined;
        /** Shorthand: full request mutation function. Takes priority over `bearer`/`headers`. */
        mutate?: ((req: Request) => Request | Promise<Request>) | undefined;
        /** Handles failed upstream attempts before the proxy returns a response. Retries do not re-verify payment. */
        onUpstreamError?: UpstreamErrorHandler<options> | undefined;
        /** Hook to modify the upstream request. Receives typed per-endpoint options via `ctx`. */
        rewriteRequest?: ((req: Request, ctx: Context & Partial<options & {}>) => Request | Promise<Request>) | undefined;
        /** Map of route patterns to endpoint definitions. */
        routes: EndpointMap;
        /** Human-readable title for the service. */
        title?: string | undefined;
    };
}
export { from as custom };
/** Renders an llms.txt markdown string for a list of services. */
export declare function toLlmsTxt(services: Service[], options?: {
    description?: string | undefined;
    openApiPath?: string | undefined;
    title?: string | undefined;
}): string;
/** Extracts per-endpoint options from an endpoint definition. */
export declare function getOptions(endpoint: Endpoint): EndpointOptions | undefined;
/** Derives discovery payment metadata from an explicitly priced endpoint handler. */
export declare function paymentOf(endpoint: Endpoint): Record<string, unknown> | null;
//# sourceMappingURL=Service.d.ts.map