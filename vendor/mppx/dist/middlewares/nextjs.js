import { generate } from '../discovery/OpenApi.js';
import * as Mppx_core from '../server/Mppx.js';
import * as Mppx_internal from './internal/mppx.js';
export * from '../server/Methods.js';
export var Mppx;
(function (Mppx) {
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
    function create(config) {
        return Mppx_internal.wrap(Mppx_core.create(config), (intent, options) => {
            return (handler) => payment(intent, options, handler);
        });
    }
    Mppx.create = create;
})(Mppx || (Mppx = {}));
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
export function payment(intent, options, handler) {
    return async (request) => {
        const result = await intent(options)(request);
        if (result.status === 402)
            return result.challenge;
        const managementResponse = getManagementResponse(result);
        if (managementResponse)
            return managementResponse;
        const response = await handler(request);
        return result.withReceipt(response);
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
 * Creates a route handler that serves an OpenAPI discovery document.
 */
export function discovery(mppx, config = {}) {
    const cached = JSON.stringify(generate(mppx, {
        ...(config.info ? { info: config.info } : {}),
        routes: config.routes ?? [],
        ...(config.serviceInfo ? { serviceInfo: config.serviceInfo } : {}),
    }));
    return () => new Response(cached, {
        headers: { ...discoveryHeaders, 'Content-Type': 'application/json' },
    });
}
//# sourceMappingURL=nextjs.js.map