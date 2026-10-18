import type * as Challenge from '../../../Challenge.js';
/** Builds Stripe metadata used to identify and analyze MPP payments. */
export declare function buildAnalytics(parameters: {
    challenge?: Pick<Challenge.Challenge, 'id' | 'intent'> | undefined;
    intent?: string | undefined;
}): Record<string, string>;
//# sourceMappingURL=analytics.d.ts.map