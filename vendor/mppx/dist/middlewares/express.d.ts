import type { Express, RequestHandler } from 'express';
import { type GenerateConfig, type RouteConfig } from '../discovery/OpenApi.js';
import * as Mppx_core from '../server/Mppx.js';
import * as Mppx_internal from './internal/mppx.js';
export * from '../server/Methods.js';
export declare namespace Mppx {
    /**
     * Creates an Express-aware payment handler where each intent
     * returns an Express `RequestHandler`.
     *
     * @example
     * ```ts
     * import express from 'express'
     * import { Mppx, tempo } from 'mppx/express'
     *
     * const app = express()
     * const mppx = Mppx.create({ methods: [tempo()] })
     *
     * app.get('/premium', mppx.charge({ amount: '1' }), (req, res) => {
     *   res.json({ data: 'paid content' })
     * })
     * ```
     */
    function create<const methods extends Mppx_core.Methods>(config: Mppx_core.create.Config<methods>): Mppx_internal.Wrap<Mppx_core.Mppx<methods>, RequestHandler>;
}
/**
 * Express middleware that gates a route behind a payment intent.
 *
 * Returns a 402 challenge if no valid credential is provided,
 * otherwise attaches a `Payment-Receipt` header to the response.
 *
 * @example
 * ```ts
 * import express from 'express'
 * import { Mppx } from 'mppx/server'
 * import { payment } from 'mppx/express'
 *
 * const mppx = Mppx.create({ methods: [tempo()] })
 *
 * const app = express()
 * app.get('/premium', payment(mppx.charge, { amount: '1' }), (req, res) => {
 *   res.json({ data: 'paid content' })
 * })
 * ```
 */
export declare function payment<const intent extends Mppx_internal.AnyMethodFn>(intent: intent, options: intent extends (options: infer options) => any ? options : never): RequestHandler;
export type DiscoveryConfig = Omit<GenerateConfig, 'routes'> & {
    path?: string;
    routes?: RouteConfig[];
};
/**
 * Mounts a `GET /openapi.json` route that serves an OpenAPI discovery document.
 */
export declare function discovery(app: Express, mppx: {
    methods: readonly Mppx_internal.AnyServer[];
    realm: string;
}, config?: DiscoveryConfig): void;
//# sourceMappingURL=express.d.ts.map