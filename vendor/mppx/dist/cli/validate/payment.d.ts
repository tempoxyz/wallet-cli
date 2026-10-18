import type { CheckResult, EndpointSpec } from './helpers.js';
export declare function validatePaymentFlow(baseUrl: string, endpoint: EndpointSpec, verbose: boolean, options: {
    body?: string | undefined;
    query?: string[] | undefined;
    extraHeaders?: string[] | undefined;
    yes?: boolean | undefined;
    silent?: boolean | undefined;
    interactive?: boolean | undefined;
    onResults?: (results: CheckResult[]) => void;
}): Promise<CheckResult[]>;
//# sourceMappingURL=payment.d.ts.map