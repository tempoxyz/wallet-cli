import type * as Method from '../Method.js';
import { type ServiceInfo } from './Discovery.js';
import * as Metadata from './internal/Metadata.js';
/** Payment handler carrying metadata used to generate discovery documents. */
export type DiscoveryHandler = ((...args: any[]) => unknown) & {
    _internal?: Metadata.Metadata;
};
export type LegacyRouteConfig = {
    intent: string;
    method: string;
    options: Record<string, unknown>;
    path: string;
    requestBody?: Record<string, unknown>;
    summary?: string;
};
export type HandlerRouteConfig = {
    handler: DiscoveryHandler;
    method: string;
    path: string;
    requestBody?: Record<string, unknown>;
    summary?: string;
};
export type RouteConfig = HandlerRouteConfig | LegacyRouteConfig;
export type GenerateConfig = {
    info?: {
        title?: string;
        version?: string;
    } | undefined;
    routes: RouteConfig[];
    serviceInfo?: ServiceInfo | undefined;
};
export type GenerateProxyConfig = {
    basePath?: string | undefined;
    info?: {
        title?: string;
        version?: string;
    } | undefined;
    routes: Array<{
        method: string;
        path: string;
        payment: Record<string, unknown> | null;
        requestBody?: Record<string, unknown>;
        summary?: string;
    }>;
    serviceInfo?: ServiceInfo | undefined;
};
/**
 * Generates an OpenAPI 3.1.0 discovery document from an mppx instance
 * and route configuration.
 */
export declare function generate(mppx: {
    methods: readonly Method.AnyServer[];
    realm: string;
}, config: GenerateConfig): Record<string, unknown>;
/**
 * Generates an OpenAPI 3.1.0 discovery document for a proxy surface.
 */
export declare function generateProxy(config: GenerateProxyConfig): Record<string, unknown>;
//# sourceMappingURL=OpenApi.d.ts.map