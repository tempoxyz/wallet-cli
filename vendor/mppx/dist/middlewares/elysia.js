import { Elysia } from 'elysia';
import { generate } from '../discovery/OpenApi.js';
import * as Mppx_core from '../server/Mppx.js';
import * as Mppx_internal from './internal/mppx.js';
export * from '../server/Methods.js';
export var Mppx;
(function (Mppx) {
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
    function create(config) {
        return Mppx_internal.wrap(Mppx_core.create(config), payment);
    }
    Mppx.create = create;
})(Mppx || (Mppx = {}));
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
export function payment(intent, options) {
    return async ({ request, set }) => {
        const result = await intent(options)(request);
        if (result.status === 402)
            return result.challenge;
        const managementResponse = getManagementResponse(result);
        if (managementResponse)
            return managementResponse;
        const receipt = result.withReceipt(new Response());
        for (const [key, value] of receipt.headers)
            set.headers[key] = value;
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
 * Returns an Elysia plugin that serves an OpenAPI discovery document.
 */
export function discovery(mppx, config = {}) {
    const mountPath = config.path ?? '/openapi.json';
    const cached = JSON.stringify(generate(mppx, {
        ...(config.info ? { info: config.info } : {}),
        routes: config.routes ?? [],
        ...(config.serviceInfo ? { serviceInfo: config.serviceInfo } : {}),
    }));
    return new Elysia().get(mountPath, () => new Response(cached, {
        headers: { ...discoveryHeaders, 'Content-Type': 'application/json' },
    }));
}
//# sourceMappingURL=elysia.js.map