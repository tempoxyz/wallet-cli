import type * as Challenge from '../../Challenge.js';
import type { MaybePromise } from '../../internal/types.js';
import type * as Method from '../../Method.js';
/** Inputs available before a client method creates a challenge credential. */
export type HandlerParameters = {
    challenge: Challenge.Challenge;
    context?: unknown;
    fetch: typeof globalThis.fetch;
    input: RequestInfo | URL;
};
/** Internal client-method challenge hook. */
export type Handler = (parameters: HandlerParameters) => MaybePromise<void>;
/** Registers an internal challenge hook without changing the public method shape. */
export declare function register<const method extends Method.AnyClient>(method: method, handler: Handler): method;
/** Returns whether a method registered pre-credential work. */
export declare function has(method: Method.AnyClient): boolean;
/** Runs method-specific work before creating a challenge credential. */
export declare function handle(method: Method.AnyClient, parameters: HandlerParameters): Promise<void>;
//# sourceMappingURL=MethodChallenge.d.ts.map