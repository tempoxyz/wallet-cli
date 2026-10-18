export type CheckResult = {
    label: string;
    detail?: string | undefined;
    hint?: string | undefined;
    severity: 'pass' | 'fail' | 'warn' | 'suggested' | 'skip';
};
export type EndpointSpec = {
    method: string;
    path: string;
    amount?: string | undefined;
    parameters?: PathParameter[] | undefined;
};
export type PathParameter = {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    schema?: {
        type?: string;
        format?: string;
        pattern?: string;
        enum?: unknown[];
        example?: unknown;
        default?: unknown;
    };
    example?: unknown;
};
export declare function check(label: string, detail?: string): CheckResult;
export declare function fail(label: string, detail?: string, hint?: string): CheckResult;
export declare function warn(label: string, detail?: string, hint?: string): CheckResult;
export declare function skip(label: string, detail?: string, hint?: string): CheckResult;
export declare function printCheck(result: CheckResult): void;
export declare function printSection(title: string): void;
export type Counts = {
    passed: number;
    failed: number;
    warnings: number;
    suggested: number;
    skipped: number;
};
export declare function printResults(results: CheckResult[], counts: Counts): void;
export declare function fetchWithTimeout(url: RequestInfo | URL, init: RequestInit, timeoutMs?: number): Promise<Response>;
export declare function formatBytes(bytes: number): string;
export declare const HTTP_METHODS: Set<string>;
export declare function isValidAddress(addr: unknown): boolean;
export declare function isValidIntegerAmount(amount: unknown): boolean;
export declare function parseEndpointArg(input: string): EndpointSpec | null;
export declare function resolveBodyForEndpoint(rawBody: string | undefined, endpointPath: string): string | undefined;
export declare function parseHeaders(raw: string[] | undefined): Record<string, string>;
//# sourceMappingURL=helpers.d.ts.map