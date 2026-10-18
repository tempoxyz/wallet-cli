/** Stable, machine-readable failure reasons; messages are for people and may change. */
export type MachineFetchErrorCode = 
/** The payment wrapper was disposed. */
'DISPOSED'
/** Policy, funder, route, or store options are invalid. */
 | 'INVALID_CONFIGURATION'
/** The payment challenge is malformed or lacks metadata that policy needs. */
 | 'INVALID_PAYMENT'
/** The payment or a funding debit exceeds a configured limit. */
 | 'LIMIT_EXCEEDED'
/** Funding failed before any funds could have moved. */
 | 'FUNDING_FAILED'
/** No trusted route could acquire the payment asset. */
 | 'NO_ROUTE'
/** The account cannot spend enough of any configured input. */
 | 'INSUFFICIENT_FUNDS'
/** Funds may have moved; reconcile the operation before retrying. */
 | 'RECOVERY_REQUIRED'
/** An operation store read or write failed. */
 | 'STORE_FAILED';
/** Base error for machine-fetch failures; branch on `code`, not on the message. */
export declare class MachineFetchError extends Error {
    readonly name: string;
    readonly code: MachineFetchErrorCode;
    constructor(message: string, options: Readonly<{
        cause?: unknown;
        code: MachineFetchErrorCode;
    }>);
}
type PolicyErrorCode = 'INVALID_CONFIGURATION' | 'INVALID_PAYMENT' | 'LIMIT_EXCEEDED';
/** A payment or configuration was rejected by local safety policy before any funds moved. */
export declare class PaymentPolicyError extends MachineFetchError {
    readonly name: string;
    readonly code: PolicyErrorCode;
    constructor(message: string, options: Readonly<{
        cause?: unknown;
        code: PolicyErrorCode;
    }>);
}
type FundingErrorCode = 'INVALID_CONFIGURATION' | 'FUNDING_FAILED' | 'NO_ROUTE' | 'INSUFFICIENT_FUNDS' | 'RECOVERY_REQUIRED';
/** A funder could not prepare the required asset. `code` defaults to FUNDING_FAILED. */
export declare class FundingError extends MachineFetchError {
    readonly name: string;
    readonly code: FundingErrorCode;
    constructor(message: string, options?: Readonly<{
        cause?: unknown;
        code?: FundingErrorCode;
    }>);
}
/** No trusted route could acquire the required asset; `cause` preserves quote failures. */
export declare class NoRouteError extends FundingError {
    readonly name: string;
    readonly code: 'NO_ROUTE';
    constructor(message: string, options?: Readonly<{
        cause?: unknown;
    }>);
}
/** The configured account does not have enough spendable balance. */
export declare class InsufficientFundsError extends FundingError {
    readonly name: string;
    readonly code: 'INSUFFICIENT_FUNDS';
    constructor(message: string, options?: Readonly<{
        cause?: unknown;
    }>);
}
/** Funding may have moved assets; reconcile `operationId` before retrying under a new one. */
export declare class FundingRecoveryError extends FundingError {
    readonly name: string;
    readonly code: 'RECOVERY_REQUIRED';
    /** Identity of the ambiguous funding operation. */
    readonly operationId: string;
    /** Provider reference of a submitted operation, when one is known. */
    readonly reference: string | undefined;
    constructor(operationId: string, options?: Readonly<{
        cause?: unknown;
        message?: string;
        reference?: string;
    }>);
}
/** An operation store rejected a read or write; never treat this as an absent operation. */
export declare class OperationStoreError extends MachineFetchError {
    readonly name: string;
    readonly code: 'STORE_FAILED';
    constructor(message: string, options?: Readonly<{
        cause?: unknown;
    }>);
}
export {};
//# sourceMappingURL=errors.d.ts.map