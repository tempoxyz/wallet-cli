import type { Funder, PaymentPlan, PaymentPreparation } from '../interfaces/funder.js';
import type { BeforePayment, MachineFetchOptions, PaymentContext, PaymentRequirement } from '../interfaces/payment.js';
import type { PaymentPolicy } from '../interfaces/policy.js';
type PrepareOptions<context> = Pick<MachineFetchOptions<context>, 'funders' | 'onEvent' | 'policy'>;
/** Resolves metadata, selects one funder, and validates policy without moving funds. */
export declare function planPayment<context = never>(initial: PaymentRequirement, options?: Readonly<{
    /** Partial policy; omitted fields receive the standard funding defaults. */
    policy?: PaymentPolicy;
    funders?: readonly Funder<context>[];
}>): Promise<PaymentPlan<context>>;
/**
 * Runs the plan's funder, if any. Only plans returned by {@link planPayment} are accepted, so a
 * modified copy cannot bypass the policy it was validated against.
 */
export declare function fundPayment<context = never>(paymentPlan: PaymentPlan<context>, context?: Partial<PaymentContext>): Promise<PaymentPreparation<context> | undefined>;
/** Builds the shared fail-closed policy and funding pipeline. */
export declare function createBeforePayment<context>(options: PrepareOptions<context>): BeforePayment<context>;
export {};
//# sourceMappingURL=prepare.d.ts.map