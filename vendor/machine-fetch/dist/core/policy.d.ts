import type { PaymentRequirement } from '../interfaces/payment.js';
import type { PaymentPolicy, ResolvedPaymentPolicy } from '../interfaces/policy.js';
/**
 * Resolves defaults and validates the policy fields of flat options once at construction time.
 * Only policy fields are read, so options may carry funders, observers, or adapter settings.
 */
export declare function resolvePolicy(options?: PaymentPolicy): ResolvedPaymentPolicy;
/**
 * Rejects a selected payment before funds or credentials are touched. A currency `maxPayment`
 * uses `currency` and `decimals` only when `trustedMetadata`, meaning a matching funder's
 * `resolve` returned them: a server that understates decimals must not shrink the payment.
 */
export declare function assertRequirement(requirement: PaymentRequirement, policy: ResolvedPaymentPolicy, trustedMetadata: boolean): void;
/**
 * Parses a non-negative base-10 decimal without floating-point arithmetic. Precision beyond
 * `decimals` cannot be represented in the payment asset and is rejected.
 */
export declare function parseUnits(value: string, decimals: number): bigint;
/** Maximum input for a quoted amount under a slippage bound, rounded up. */
export declare function addSlippage(amount: bigint, basisPoints: number): bigint;
