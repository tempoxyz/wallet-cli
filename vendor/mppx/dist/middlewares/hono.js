import { generate } from '../discovery/OpenApi.js';
import * as Scope from '../server/internal/scope.js';
import * as Mppx_core from '../server/Mppx.js';
import * as Mppx_internal from './internal/mppx.js';
export * from '../server/Methods.js';
export var Mppx;
(function (Mppx) {
    /**
     * Creates a Hono-aware payment handler where each intent
     * returns a Hono `MiddlewareHandler`.
     *
     * @example
     * ```ts
     * import { Hono } from 'hono'
     * import { Mppx, tempo } from 'mppx/hono'
     *
     * const app = new Hono()
     * const mppx = Mppx.create({ methods: [tempo()] })
     *
     * app.get('/premium', mppx.charge({ amount: '1' }), (c) =>
     *   c.json({ data: 'paid content' }),
     * )
     * ```
     */
    function create(config) {
        return Mppx_internal.wrap(Mppx_core.create(config), payment);
    }
    Mppx.create = create;
})(Mppx || (Mppx = {}));
/**
 * Hono middleware that gates a route behind a payment intent.
 *
 * Returns a 402 challenge if no valid credential is provided,
 * otherwise attaches a `Payment-Receipt` header to the response.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { Mppx } from 'mppx/server'
 * import { payment } from 'mppx/hono'
 *
 * const mppx = Mppx.create({ methods: [tempo()] })
 *
 * const app = new Hono()
 * app.get('/premium', payment(mppx.charge, { amount: '1' }), (c) =>
 *   c.json({ data: 'paid content' }),
 * )
 * ```
 */
export function payment(intent, options) {
    return async (c, next) => {
        const request = options.scope === undefined && Scope.read(options.meta) === undefined
            ? Scope.attach(c.req.raw, `${c.req.method.toUpperCase()} ${c.req.routePath || c.req.path}`)
            : c.req.raw;
        const result = await intent(options)(request);
        if (result.status === 402)
            return result.challenge;
        const managementResponse = getManagementResponse(result);
        if (managementResponse)
            return managementResponse;
        await next();
        c.res = result.withReceipt(c.res);
    };
}
function getManagementResponse(result) {
    try {
        return result.withReceipt();
    }
    catch (error) {
        if (Mppx_core.isMissingReceiptResponseError(error)) {
            return null;
        }
        throw error;
    }
}
const discoveryHeaders = { 'Cache-Control': 'public, max-age=300' };
/**
 * Mounts a `GET /openapi.json` route that serves an OpenAPI discovery document.
 *
 * When `auto` is true, routes are introspected from Hono's internal `app.routes`
 * array. This is a **best-effort / experimental** convenience — `app.routes` is
 * not part of Hono's stable public API and may change across versions. Prefer
 * passing explicit `routes` for production use.
 */
export function discovery(app, mppx, config = {}) {
    const mountPath = config.path ?? '/openapi.json';
    let cached;
    app.get(mountPath, (c) => {
        if (!cached) {
            const routes = config.routes ?? (config.auto ? introspectRoutes(app) : []);
            const doc = generate(mppx, {
                ...(config.info ? { info: config.info } : {}),
                routes,
                ...(config.serviceInfo ? { serviceInfo: config.serviceInfo } : {}),
            });
            cached = JSON.stringify(doc);
        }
        c.header('Cache-Control', discoveryHeaders['Cache-Control']);
        c.header('Content-Type', 'application/json');
        return c.body(cached);
    });
}
function introspectRoutes(app) {
    const routes = [];
    const appRoutes = app.routes;
    if (!appRoutes)
        return routes;
    const seen = new Set();
    for (const route of appRoutes) {
        const internal = route.handler
            ?._internal;
        if (!internal)
            continue;
        const key = `${route.method}:${route.path}:${internal.name}/${internal.intent}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        routes.push({
            handler: route.handler,
            method: route.method,
            path: route.path,
        });
    }
    return routes;
}
//# sourceMappingURL=hono.js.map