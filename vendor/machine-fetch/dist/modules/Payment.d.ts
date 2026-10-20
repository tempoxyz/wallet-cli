import type { PaymentPlan, PaymentPreparation } from '../interfaces/funder.js';
import type { PaymentContext, PaymentRequirement } from '../interfaces/payment.js';
import type { PaymentPolicy } from '../interfaces/policy.js';
import type * as Errors from './Errors.js';
import type * as Funder from './Funder.js';
import type * as Policy from './Policy.js';
export type { PaymentPlan as Plan, PaymentPreparation as Preparation, } from '../interfaces/funder.js';
export type { BeforePayment, BoundPaymentClient as BoundClient, PaymentClient as Client, PaymentContext as Context, PaymentRequirement as Requirement, } from '../interfaces/payment.js';
/**
 * Resolves metadata, selects one funder, and validates policy without moving funds.
 *
 * @example
 * ```ts
 * const plan = await Payment.plan(requirement, { maxPayment, funders })
 * if (plan.funder) console.log(plan.funder.name)
 * ```
 */
export declare const plan: <context = never>(requirement: PaymentRequirement, options?: plan.Options<context>) => Promise<PaymentPlan<context>>;
export declare namespace plan {
    /** Options for {@link plan}: funders plus local policy, whose omitted fields take their defaults. */
    type Options<context = never> = Readonly<{
        /** Ordered funders; only the first match prepares funds. @default [] */
        funders?: readonly Funder.Funder<context>[] | undefined;
    }> & PaymentPolicy;
    /** Errors {@link plan} can throw. A funder's `resolve` may also throw its own errors. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Policy.InvalidPaymentErrorType | Policy.LimitExceededErrorType | Errors.GlobalErrorType;
}
/**
 * Runs the plan's funder, if any. Only plans returned by {@link plan} are accepted, so a modified
 * copy cannot bypass the policy it was validated against.
 */
export declare const fund: <context = never>(plan: PaymentPlan<context>, context?: Partial<PaymentContext>) => Promise<PaymentPreparation<context> | undefined>;
export declare namespace fund {
    /** Errors {@link fund} can throw. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Funder.FundingErrorType | Funder.NoRouteErrorType | Funder.InsufficientFundsErrorType | Funder.FundingRecoveryErrorType | Errors.OperationStoreErrorType | Errors.GlobalErrorType;
}
