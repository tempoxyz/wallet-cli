import type { HTTPRequestContext, PaywallConfig, RoutesConfig } from '@x402/core/server';
import { x402HTTPResourceServer } from '@x402/core/server';
import * as Evm from './Evm.js';
/** Configuration for MPP negotiation over an existing x402 route table. */
export type Config = Evm.Config & {
    /** Optional x402 paywall configuration used while resolving payment requirements. */
    paywallConfig?: PaywallConfig | undefined;
    /** Existing x402 route configuration. */
    routes: RoutesConfig;
};
/** Decision produced before an official x402 framework adapter runs. */
export type Result = {
    status: 'handled';
    response: Response;
} | {
    status: 'paid';
    withReceipt(response: Response): Response;
} | {
    status: 'unprotected';
} | {
    status: 'x402';
};
/** Shared negotiator used by the x402 compatibility integrations. */
export type Negotiator = {
    /** x402 HTTP server passed through to official framework adapters. */
    httpServer: x402HTTPResourceServer;
    /** Selects MPP, x402, or an immediate response for a request. */
    negotiate(request: Request, context: HTTPRequestContext): Promise<Result>;
};
/** Creates the native MPP side of an x402 compatibility integration. */
export declare function create(config: Config): Negotiator;
/** Reads a current or legacy x402 payment credential. */
export declare function getX402Credential(request: Request): string | undefined;
/** Converts a Fetch request to the context consumed by x402 core. */
export declare function createContext(request: Request, body?: unknown): HTTPRequestContext;
//# sourceMappingURL=Negotiator.d.ts.map