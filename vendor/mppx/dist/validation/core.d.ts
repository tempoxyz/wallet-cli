import { buildUrl } from '../cli/validate/discovery.js';
import type { CheckResult, EndpointSpec, PathParameter } from '../cli/validate/helpers.js';
export { buildUrl };
export type { CheckResult, EndpointSpec, PathParameter };
export type ValidateOptions = {
    url: string;
    endpoint?: string | undefined;
    body?: string | undefined;
    query?: string[] | undefined;
    headers?: string[] | undefined;
    verbose?: boolean | undefined;
    yes?: boolean | undefined;
    skipPayment?: boolean | undefined;
    interactive?: boolean | undefined;
    discoveryPath?: string | undefined;
    onPaymentResults?: (results: CheckResult[]) => void;
};
export type DiscoveryResult = {
    found: boolean;
    valid: boolean;
    endpoints: EndpointSpec[];
    checks: CheckResult[];
    doc: Record<string, unknown> | null;
};
export type EndpointValidationResult = {
    method: string;
    path: string;
    challenge: CheckResult[];
    errorHandling: CheckResult[];
    payment: CheckResult[];
};
export type ValidateResult = {
    url: string;
    discovery: DiscoveryResult;
    endpoints: EndpointValidationResult[];
    summary: {
        passed: number;
        failed: number;
        warnings: number;
        suggested: number;
        skipped: number;
    };
    suggestions: string[];
};
export type ValidateEvent = {
    phase: 'discovery';
    discovery: DiscoveryResult;
    results: CheckResult[];
} | {
    phase: 'endpoint';
    endpoint: EndpointSpec;
} | {
    phase: 'challenge';
    endpoint: EndpointSpec;
    results: CheckResult[];
    isMpp: boolean;
    isTestnet: boolean;
    isMainnet: boolean;
    isNonMppPayment: boolean;
    isMalformedChallenge: boolean;
    methods: string[];
} | {
    phase: 'errorHandling';
    endpoint: EndpointSpec;
    results: CheckResult[];
} | {
    phase: 'payment';
    endpoint: EndpointSpec;
    results: CheckResult[];
    succeeded: boolean;
    body?: string | undefined;
};
/** Streams validation results as each phase completes. */
export declare function validateStream(options: ValidateOptions): AsyncGenerator<ValidateEvent>;
/** Runs the full validation suite and returns all results as a batch. */
export declare function validate(options: ValidateOptions): Promise<ValidateResult>;
//# sourceMappingURL=core.d.ts.map