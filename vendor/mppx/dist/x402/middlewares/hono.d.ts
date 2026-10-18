import type { RoutesConfig, x402ResourceServer } from '@x402/core/server';
import type { MiddlewareHandler } from 'hono';
import * as Negotiator from '../../integrations/x402/Negotiator.js';
/** Hono-specific configuration for {@link mpp}. */
export type Config = Omit<Negotiator.Config, 'routes' | 'server'>;
/**
 * Adds MPP negotiation to the official x402 Hono middleware.
 *
 * The official adapter retains ownership of Hono response handling, cancellation,
 * extensions, and post-handler x402 settlement.
 */
export declare function mpp(routes: RoutesConfig, server: x402ResourceServer, config: Config): MiddlewareHandler;
//# sourceMappingURL=hono.d.ts.map