import * as Types from '../Types.js';
export type HttpOptions = {
    /** Fetch implementation used for facilitator RPCs. */
    fetch?: typeof globalThis.fetch | undefined;
};
/** Resolves an x402 facilitator URL or client into a facilitator client. */
export declare function resolve(facilitator: string | Types.Facilitator, errorMessage?: string, options?: HttpOptions | undefined): Types.Facilitator;
/** Creates an x402 facilitator client from an HTTP base URL. */
export declare function http(url: string, options?: HttpOptions | undefined): Types.Facilitator;
/** Returns the underlying raw fetch implementation when given an mppx wrapper. */
export declare function unwrapFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch;
//# sourceMappingURL=Facilitator.d.ts.map