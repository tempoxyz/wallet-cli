/**
 * The funder interface, its receipts, and the errors funders raise. A funder acquires the payment
 * asset when the wallet does not hold it.
 * @module
 */
export type { FundingErrorType, FundingRecoveryErrorType, InsufficientFundsErrorType, NoRouteErrorType, } from '../core/errors.js';
export { FundingError, FundingRecoveryError, InsufficientFundsError, NoRouteError, } from '../core/errors.js';
export type { AcquiredReceipt, AvailableReceipt, FundContext as Context, Funder, FundingReceipt as Receipt, } from '../interfaces/funder.js';
