import type * as http from 'node:http';
import * as Service from './Service.js';
/** A paid API proxy that gates upstream services behind the mppx 402 protocol. */
export type Proxy = {
    /** Fetch API handler. Works with Bun, Deno, Next.js, Hono, Elysia, SvelteKit, etc. */
    fetch: (request: Request) => Promise<Response>;
    /** Node.js request listener. Works with Express, Fastify, `http.createServer`, etc. */
    listener: (req: http.IncomingMessage, res: http.ServerResponse) => void;
};
/**
 * Creates a paid API proxy.
 *
 * Routes incoming requests to upstream services, injects credentials,
 * and requires payment via the mppx 402 protocol for non-free endpoints.
 *
 * @example
 * ```ts
 * import { Proxy, openai } from 'mppx/proxy'
 * import { Mppx, tempo } from 'mppx/server'
 *
 * const mppx = Mppx.create({ methods: [tempo()] })
 *
 * const proxy = Proxy.create({
 *   services: [
 *     openai({
 *       apiKey: 'sk-...',
 *       routes: {
 *         'POST /v1/chat/completions': mppx.charge({ amount: '0.05' }),
 *         'GET /v1/models': true,
 *       },
 *     }),
 *   ],
 * })
 * ```
 */
export declare function create(config: create.Config): Proxy;
export declare namespace create {
    type Config = {
        /** Base path prefix to strip before routing (e.g. `'/api/proxy'`). */
        basePath?: string | undefined;
        /** Free-form categories for root discovery metadata. */
        categories?: string[] | undefined;
        /** Short description of the proxy shown in `llms.txt`. */
        description?: string | undefined;
        /** Structured documentation links for root discovery metadata. */
        docs?: Service.Docs | undefined;
        /** Custom `fetch` implementation. Defaults to `globalThis.fetch`. */
        fetch?: typeof globalThis.fetch | undefined;
        /** Default handler for failed upstream attempts. Services may override it. */
        onUpstreamError?: Service.UpstreamErrorHandler | undefined;
        /** Services to proxy. Each service is mounted at `/{serviceId}/`. */
        services: Service.Service[];
        /** Human-readable title for the proxy shown in `llms.txt`. */
        title?: string | undefined;
        /** Version to include in the generated OpenAPI document. */
        version?: string | undefined;
    };
}
//# sourceMappingURL=Proxy.d.ts.map