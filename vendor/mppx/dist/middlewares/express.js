import { generate } from '../discovery/OpenApi.js';
import * as Mppx_core from '../server/Mppx.js';
import * as ExpressAdapter from './internal/express.js';
import * as Mppx_internal from './internal/mppx.js';
export * from '../server/Methods.js';
export var Mppx;
(function (Mppx) {
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
    function create(config) {
        return Mppx_internal.wrap(Mppx_core.create(config), payment);
    }
    Mppx.create = create;
})(Mppx || (Mppx = {}));
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
export function payment(intent, options) {
    return async (req, res, next) => {
        const request = ExpressAdapter.toRequest(req);
        const result = await intent(options)(request);
        if (result.status === 402) {
            const challenge = result.challenge;
            await ExpressAdapter.sendResponse(res, challenge);
            return;
        }
        const managementResponse = (() => {
            try {
                return result.withReceipt();
            }
            catch (error) {
                if (Mppx_core.isMissingReceiptResponseError(error))
                    return null;
                throw error;
            }
        })();
        if (managementResponse) {
            res.status(managementResponse.status);
            ExpressAdapter.copyHeaders(res, managementResponse.headers);
            if (managementResponse.body === null) {
                res.end();
                return;
            }
            res.send(Buffer.from(await managementResponse.arrayBuffer()));
            return;
        }
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            const wrapped = result.withReceipt(Response.json(body));
            ExpressAdapter.copyHeaders(res, wrapped.headers);
            return originalJson(body);
        };
        next();
    };
}
const discoveryHeaders = { 'Cache-Control': 'public, max-age=300' };
/**
 * Mounts a `GET /openapi.json` route that serves an OpenAPI discovery document.
 */
export function discovery(app, mppx, config = {}) {
    const mountPath = config.path ?? '/openapi.json';
    const cached = JSON.stringify(generate(mppx, {
        ...(config.info ? { info: config.info } : {}),
        routes: config.routes ?? [],
        ...(config.serviceInfo ? { serviceInfo: config.serviceInfo } : {}),
    }));
    app.get(mountPath, (_req, res) => {
        res.setHeader('Cache-Control', discoveryHeaders['Cache-Control']);
        res.setHeader('Content-Type', 'application/json');
        res.end(cached);
    });
}
//# sourceMappingURL=express.js.map