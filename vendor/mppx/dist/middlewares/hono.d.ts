import type { Hono, MiddlewareHandler } from 'hono';
import { type GenerateConfig, type RouteConfig } from '../discovery/OpenApi.js';
import * as Mppx_core from '../server/Mppx.js';
import * as Mppx_internal from './internal/mppx.js';
export * from '../server/Methods.js';
export declare namespace Mppx {
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
    function create<const methods extends Mppx_core.Methods>(config: Mppx_core.create.Config<methods>): Mppx_internal.Wrap<Mppx_core.Mppx<methods>, MiddlewareHandler>;
}
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
export declare function payment<const intent extends Mppx_internal.AnyMethodFn>(intent: intent, options: intent extends (options: infer options) => any ? options : never): MiddlewareHandler;
export type DiscoveryConfig = Omit<GenerateConfig, 'routes'> & {
    auto?: boolean;
    path?: string;
    routes?: RouteConfig[];
};
/**
 * Mounts a `GET /openapi.json` route that serves an OpenAPI discovery document.
 *
 * When `auto` is true, routes are introspected from Hono's internal `app.routes`
 * array. This is a **best-effort / experimental** convenience — `app.routes` is
 * not part of Hono's stable public API and may change across versions. Prefer
 * passing explicit `routes` for production use.
 */
export declare function discovery(app: Hono<any>, mppx: {
    methods: readonly Mppx_internal.AnyServer[];
    realm: string;
}, config?: DiscoveryConfig): void;
//# sourceMappingURL=hono.d.ts.map