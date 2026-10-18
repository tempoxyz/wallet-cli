import * as Types from '../Types.js';
const mppxFetchWrapper = Symbol.for('mppx.fetch.wrapper');
/** Resolves an x402 facilitator URL or client into a facilitator client. */
export function resolve(facilitator, errorMessage = 'x402 exact requires `facilitator`.', options) {
    if (typeof facilitator === 'object' && facilitator !== null)
        return facilitator;
    if (typeof facilitator === 'string')
        return http(facilitator, options);
    throw new Error(errorMessage);
}
/** Creates an x402 facilitator client from an HTTP base URL. */
export function http(url, options) {
    const base = url.replace(/\/$/, '');
    const fetch = unwrapFetch(options?.fetch ?? globalThis.fetch);
    return {
        async verify(paymentPayload, paymentRequirements) {
            const response = await fetch(`${base}/verify`, {
                body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            return Types.VerifyResponseSchema.parse(await response.json());
        },
        async settle(paymentPayload, paymentRequirements) {
            const response = await fetch(`${base}/settle`, {
                body: JSON.stringify({ paymentPayload, paymentRequirements, x402Version: 2 }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            });
            return Types.SettleResponseSchema.parse(await response.json());
        },
    };
}
/** Returns the underlying raw fetch implementation when given an mppx wrapper. */
export function unwrapFetch(fetch) {
    let current = fetch;
    while (current[mppxFetchWrapper]) {
        current = current[mppxFetchWrapper];
    }
    return current;
}
//# sourceMappingURL=Facilitator.js.map