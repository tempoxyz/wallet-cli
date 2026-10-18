import type { RoutesConfig, x402ResourceServer } from '@x402/core/server';
import type { RequestHandler } from 'express';
import * as Negotiator from '../../integrations/x402/Negotiator.js';
/** Express-specific configuration for {@link mpp}. */
export type Config = Omit<Negotiator.Config, 'routes' | 'server'>;
/**
 * Adds MPP negotiation to the official x402 Express middleware.
 *
 * x402 retains ownership of response buffering, handler cancellation, hooks, and
 * post-handler settlement. This wrapper only handles MPP credentials and appends
 * an MPP challenge to unpaid x402 responses.
 *
 * @example
 * ```ts
 * import { mpp } from 'mppx/x402/express'
 *
 * app.use(mpp(routes, resourceServer, {
 *   secretKey: process.env.MPP_SECRET_KEY!,
 * }))
 * ```
 */
export declare function mpp(routes: RoutesConfig, server: x402ResourceServer, config: Config): RequestHandler;
//# sourceMappingURL=express.d.ts.map