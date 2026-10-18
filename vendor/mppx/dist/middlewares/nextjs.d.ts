import { type GenerateConfig, type RouteConfig } from '../discovery/OpenApi.js';
import * as Mppx_core from '../server/Mppx.js';
import * as Mppx_internal from './internal/mppx.js';
export * from '../server/Methods.js';
type RouteHandler = (request: Request) => Promise<Response> | Response;
type NextjsHandler = (handler: RouteHandler) => RouteHandler;
export declare namespace Mppx {
    /**
     * Creates a Next.js-aware payment handler where each intent
     * returns a wrapper that accepts a route handler.
     *
     * @example
     * ```ts
     * // app/api/premium/route.ts
     * import { Mppx, tempo } from 'mppx/nextjs'
     *
     * const mppx = Mppx.create({ methods: [tempo()] })
     *
     * export const GET = mppx.charge({ amount: '1' })(() =>
     *   Response.json({ data: 'paid content' }),
     * )
     * ```
     */
    function create<const methods extends Mppx_core.Methods>(config: Mppx_core.create.Config<methods>): Mppx_internal.Wrap<Mppx_core.Mppx<methods>, NextjsHandler>;
}
/**
 * Next.js route handler wrapper that gates a route behind a payment intent.
 *
 * Returns a 402 challenge if no valid credential is provided,
 * otherwise attaches a `Payment-Receipt` header to the response.
 *
 * @example
 * ```ts
 * // app/api/premium/route.ts
 * import { Mppx } from 'mppx/server'
 * import { payment } from 'mppx/nextjs'
 *
 * const mppx = Mppx.create({ methods: [tempo()] })
 *
 * export const GET = payment(mppx.charge, { amount: '1' }, () =>
 *   Response.json({ data: 'paid content' }),
 * )
 * ```
 */
export declare function payment<const intent extends Mppx_internal.AnyMethodFn>(intent: intent, options: intent extends (options: infer options) => any ? options : never, handler: RouteHandler): RouteHandler;
export type DiscoveryConfig = Omit<GenerateConfig, 'routes'> & {
    routes?: RouteConfig[];
};
/**
 * Creates a route handler that serves an OpenAPI discovery document.
 */
export declare function discovery(mppx: {
    methods: readonly Mppx_internal.AnyServer[];
    realm: string;
}, config?: DiscoveryConfig): RouteHandler;
//# sourceMappingURL=nextjs.d.ts.map