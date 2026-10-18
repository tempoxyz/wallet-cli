import * as Challenge from '../Challenge.js';
import type * as Errors from '../Errors.js';
/**
 * Creates a 402 Payment Required response with a `WWW-Authenticate: Payment` header.
 *
 * Optionally includes RFC 9457 Problem Details in the response body when an error is provided.
 *
 * @param parameters - The challenge and optional error.
 * @returns A 402 Response suitable for returning from a route handler.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mppx'
 * import { Response } from 'mppx/server'
 *
 * const challenge = Challenge.from({ id: '...', realm: 'api.example.com', method: 'tempo', intent: 'charge', request: { ... } })
 * return Response.requirePayment({ challenge })
 * ```
 */
export declare function requirePayment(parameters: requirePayment.Parameters): Response;
export declare namespace requirePayment {
    type Parameters = {
        challenge: Challenge.Challenge;
        error?: Errors.PaymentError | undefined;
    };
}
//# sourceMappingURL=Response.d.ts.map