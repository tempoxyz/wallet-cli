import type { RouteConfig, RoutesConfig, x402ResourceServer } from '@x402/core/server';
import { type NextRequest } from 'next/server.js';
import * as Negotiator from '../../integrations/x402/Negotiator.js';
type RouteHandler<arguments_ extends unknown[] = []> = (request: NextRequest, ...arguments_: arguments_) => Promise<Response> | Response;
/** Next.js-specific configuration for MPP compatibility wrappers. */
export type Config = Omit<Negotiator.Config, 'routes' | 'server'>;
/**
 * Adds MPP negotiation to the official x402 Next.js route wrapper.
 *
 * The official adapter retains ownership of route execution, cancellation,
 * extensions, and post-handler x402 settlement.
 */
export declare function mpp<arguments_ extends unknown[]>(handler: RouteHandler<arguments_>, route: RouteConfig, server: x402ResourceServer, config: Config): RouteHandler<arguments_>;
/** Creates a dual-protocol Next.js proxy handler backed by the official x402 proxy. */
export declare function mppProxy(routes: RoutesConfig, server: x402ResourceServer, config: Config): RouteHandler;
export {};
//# sourceMappingURL=next.d.ts.map