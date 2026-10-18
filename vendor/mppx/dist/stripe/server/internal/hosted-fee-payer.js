const stripeFeepayerHost = 'mpp.stripe.com';
const stripeFeepayerPath = '/tempo/feepayer';
const url = `https://${stripeFeepayerHost}${stripeFeepayerPath}`;
/**
 * Creates an instance of a Stripe feepayer using an authenticated Stripe client.
 *
 * This compatibility path uses the Stripe client so that requests to the feepayer
 * retain their authentication, timeouts, telemetry, and request events.
 */
export function create(client) {
    const requestSender = client._requestSender;
    if (!requestSender?._request)
        throw new Error('Stripe hosted fee payer requires a compatible Stripe Node SDK client.');
    return { fetch: createFetch(requestSender), url };
}
function createFetch(requestSender) {
    return async (_url, request) => {
        // Remote fee-payer requests must be JSON-RPC POST requests.
        if (request?.method !== 'POST' || typeof request.body !== 'string')
            throw new Error('Stripe hosted fee payer requires a JSON POST request.');
        const body = JSON.parse(request.body);
        try {
            // Make the request to the feepayer through the Stripe client so that we can reuse auth and telemetry.
            const stream = await new Promise((resolve, reject) => {
                requestSender._request('POST', stripeFeepayerHost, stripeFeepayerPath, body, null, {
                    headers: { 'Content-Type': 'application/json' },
                    settings: { maxNetworkRetries: 0 },
                    streaming: true,
                }, ['mpp_feepayer'], (error, response) => error ? reject(error) : resolve(response), (_method, data, _headers, callback) => callback(null, JSON.stringify(data)));
            });
            return new Response(stream, {
                headers: { 'Content-Type': 'application/json' },
                status: 200,
            });
        }
        catch (error) {
            // Convert Stripe transport failure into the JSON-RPC shape viem expects.
            const stripeError = error;
            return Response.json({
                error: {
                    code: typeof stripeError.code === 'number' ? stripeError.code : -32603,
                    message: typeof stripeError.message === 'string'
                        ? stripeError.message
                        : 'Stripe fee-payer request failed',
                },
                id: body.id ?? null,
                jsonrpc: '2.0',
            }, {
                status: typeof stripeError.statusCode === 'number' ? stripeError.statusCode : 502,
            });
        }
    };
}
//# sourceMappingURL=hosted-fee-payer.js.map