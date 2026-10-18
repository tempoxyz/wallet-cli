import * as Service from '../Service.js';
/**
 * Creates a Stripe service definition.
 *
 * Injects `Authorization: Basic` header (API key as username) for upstream authentication.
 * Per-endpoint `apiKey` overrides are supported via `options`.
 *
 * @example
 * ```ts
 * stripe({
 *   apiKey: 'sk-...',
 *   routes: {
 *     'POST /v1/charges': mppx.charge({ amount: '1' }),
 *     'GET /v1/customers/:id': true,
 *   },
 * })
 * ```
 */
export declare function stripe(config: stripe.Config): Service.Service;
export declare namespace stripe {
    type Config = Service.From<{
        /** Stripe API key. Used as Basic auth username. */
        apiKey: string;
        /** Base URL override. Defaults to `'https://api.stripe.com'`. */
        baseUrl?: string | undefined;
        routes: 'POST /v1/charges' | 'POST /v1/customers' | 'GET /v1/customers/:id' | 'POST /v1/payment_intents' | 'GET /v1/payment_intents/:id' | 'POST /v1/subscriptions' | 'GET /v1/subscriptions/:id' | 'POST /v1/invoices' | 'GET /v1/invoices/:id';
    }>;
}
//# sourceMappingURL=stripe.d.ts.map