import type { CheckResult, EndpointSpec } from './helpers.js';
export declare function fetchDiscoveryDoc(baseUrl: string): Promise<{
    doc: unknown;
    raw: string;
} | {
    error: string;
}>;
/** Checks that the server publishes nonempty text documentation at /llms.txt. */
export declare function validateLlmsDoc(baseUrl: string): Promise<CheckResult>;
export declare function extractEndpointsFromDiscovery(doc: Record<string, unknown>): EndpointSpec[];
export declare function extractRequestBodyFromDiscovery(doc: Record<string, unknown>, endpoint: EndpointSpec): string | undefined;
export declare function buildUrl(baseUrl: string, endpoint: EndpointSpec, query?: string[]): string;
//# sourceMappingURL=discovery.d.ts.map