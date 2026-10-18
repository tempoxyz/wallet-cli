import { Elysia, type Context } from 'elysia';
import { type GenerateConfig, type RouteConfig } from '../discovery/OpenApi.js';
import * as Mppx_core from '../server/Mppx.js';
import * as Mppx_internal from './internal/mppx.js';
export * from '../server/Methods.js';
type ElysiaHook = (context: Context) => Promise<Response | undefined>;
export declare namespace Mppx {
    /**
     * Creates an Elysia-aware payment handler where each intent
     * returns an Elysia `beforeHandle` hook.
     *
     * Use with `.guard()` to scope payment to specific routes,
     * or `.onBeforeHandle()` to apply globally.
     *
     * @example
     * ```ts
     * import { Elysia } from 'elysia'
     * import { Mppx, tempo } from 'mppx/elysia'
     *
     * const mppx = Mppx.create({ methods: [tempo()] })
     *
     * const app = new Elysia()
     *   .guard(
     *     { beforeHandle: mppx.charge({ amount: '1' }) },
     *     (app) => app.get('/premium', () => ({ data: 'paid content' })),
     *   )
     * ```
     */
    function create<const methods extends Mppx_core.Methods>(config: Mppx_core.create.Config<methods>): Mppx_internal.Wrap<Mppx_core.Mppx<methods>, ElysiaHook>;
}
/**
 * Elysia `beforeHandle` hook that gates a route behind a payment intent.
 *
 * Returns a 402 challenge if no valid credential is provided.
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia'
 * import { Mppx } from 'mppx/server'
 * import { payment } from 'mppx/elysia'
 *
 * const mppx = Mppx.create({ methods: [tempo()] })
 *
 * const app = new Elysia()
 *   .guard(
 *     { beforeHandle: payment(mppx.charge, { amount: '1' }) },
 *     (app) => app.get('/premium', () => ({ data: 'paid content' })),
 *   )
 * ```
 */
export declare function payment<const intent extends Mppx_internal.AnyMethodFn>(intent: intent, options: intent extends (options: infer options) => any ? options : never): ElysiaHook;
export type DiscoveryConfig = Omit<GenerateConfig, 'routes'> & {
    path?: string;
    routes?: RouteConfig[];
};
/**
 * Returns an Elysia plugin that serves an OpenAPI discovery document.
 */
export declare function discovery(mppx: {
    methods: readonly Mppx_internal.AnyServer[];
    realm: string;
}, config?: DiscoveryConfig): Elysia<"", {
    decorator: {};
    store: {};
    derive: {};
    resolve: {};
}, {
    typebox: {};
    error: {};
}, {
    schema: {};
    standaloneSchema: {};
    macro: {};
    macroFn: {};
    parser: {};
    response: {};
}, {
    [x: string]: {
        get: {
            body: unknown;
            params: {};
            query: unknown;
            headers: unknown;
            response: {
                200: Response;
            };
        };
    };
}, {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
}, {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
}>;
//# sourceMappingURL=elysia.d.ts.map