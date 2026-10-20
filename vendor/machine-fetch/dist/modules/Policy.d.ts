/**
 * Local spending limits, and the errors raised when a payment breaks them. Policy errors occur
 * before anything is signed or any funds move.
 * @module
 */
export type { InvalidPaymentErrorType, LimitExceededErrorType } from '../core/errors.js';
export { InvalidPaymentError, LimitExceededError, PaymentPolicyError } from '../core/errors.js';
export type { AssetAmount, FundingPolicy as Funding, Money, PaymentPolicy as Policy, } from '../interfaces/policy.js';
