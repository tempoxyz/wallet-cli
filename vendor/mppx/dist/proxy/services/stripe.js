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
export function stripe(config) {
    return Service.from('stripe', {
        baseUrl: config.baseUrl ?? 'https://api.stripe.com',
        categories: ['payments'],
        description: 'Payment processing, customers, subscriptions, and invoices.',
        docs: {
            apiReference: 'https://docs.stripe.com/api',
            homepage: 'https://docs.stripe.com',
            llms: 'https://docs.stripe.com/llms.txt',
        },
        onUpstreamError: config.onUpstreamError,
        rewriteRequest(request, ctx) {
            const apiKey = ctx.apiKey ?? config.apiKey;
            request.headers.delete('Stripe-Account');
            request.headers.set('Authorization', `Basic ${btoa(`${apiKey}:`)}`);
            return request;
        },
        routes: config.routes,
        title: 'Stripe',
    });
}
//# sourceMappingURL=stripe.js.map