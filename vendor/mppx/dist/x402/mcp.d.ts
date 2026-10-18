import type { x402ResourceServer } from '@x402/core/server';
import { type MCPToolCallback, type PaymentWrappedHandler, type PaymentWrapperConfig } from '@x402/mcp';
import * as Negotiator from '../integrations/x402/Negotiator.js';
type ToolResource = NonNullable<PaymentWrapperConfig['resource']> & {
    url: `mcp://tool/${string}`;
};
/** Configuration for {@link mpp}. A canonical MCP tool URL is required as its identity. */
export type Config = Omit<PaymentWrapperConfig, 'resource'> & Pick<Negotiator.Config, 'realm' | 'secretKey'> & {
    resource: ToolResource;
};
/**
 * Creates an MCP tool wrapper that accepts both MPP and x402 payment metadata.
 *
 * Existing x402 credentials and lifecycle hooks continue through `@x402/mcp`.
 * MPP credentials reuse the same x402 requirements, verifier, and facilitator;
 * x402-only hooks in `PaymentWrapperConfig.hooks` therefore run only on x402 calls.
 */
export declare function mpp(resourceServer: x402ResourceServer, config: Config): <arguments_ extends Record<string, unknown>>(handler: PaymentWrappedHandler<arguments_>) => MCPToolCallback<arguments_>;
export {};
//# sourceMappingURL=mcp.d.ts.map