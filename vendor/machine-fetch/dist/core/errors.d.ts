/** Options shared by every machine-fetch error. */
export type MachineFetchErrorOptions = Readonly<{
    /** The underlying failure. Its message is not copied into this error's message. */
    cause?: unknown;
    /** Bounded, safe diagnostic detail appended to the message. */
    details?: string | undefined;
    /** Extra context lines rendered between the summary and the hint. */
    metaMessages?: readonly string[] | undefined;
}>;
/**
 * Base error for machine-fetch failures. Narrow with `instanceof` or on the namespaced `name`,
 * never on the message. `shortMessage` is the one-line summary; `message` adds context, a hint,
 * and a link to the error reference.
 */
export declare class MachineFetchError extends Error {
    readonly name: string;
    /** One-line summary, without context, hint, or docs link. */
    readonly shortMessage: string;
    /** Bounded diagnostic detail, when the thrower supplied it. */
    readonly details: string | undefined;
    /** Extra context lines. */
    readonly metaMessages: readonly string[] | undefined;
    /** The next step to resolve the failure. */
    readonly hint: string | undefined;
    /** Reference for every error class. */
    readonly docsUrl: string;
    constructor(shortMessage: string, options?: MachineFetchErrorOptions & Readonly<{
        hint?: string | undefined;
    }>);
    /** The deepest error in the `cause` chain, starting with this error. */
    walk(): unknown;
    /** The first error in the `cause` chain, starting with this error, that `match` accepts. */
    walk(match: (error: unknown) => boolean): unknown;
}
/** A disposed payment wrapper or x402 binding was called. */
export declare class DisposedError extends MachineFetchError {
    readonly name: string;
    constructor(shortMessage: string, options?: MachineFetchErrorOptions);
}
/** Options are invalid, or an API is misused. Raised before any funds move. */
export declare class InvalidConfigurationError extends MachineFetchError {
    readonly name: string;
    constructor(shortMessage: string, options?: MachineFetchErrorOptions);
}
/** A payment was rejected by local safety policy before anything was signed or any funds moved. */
export declare abstract class PaymentPolicyError extends MachineFetchError {
    readonly name: string;
}
/** The payment challenge is malformed, or a `Money` limit has no token metadata to compare. */
export declare class InvalidPaymentError extends PaymentPolicyError {
    readonly name: string;
    constructor(shortMessage: string, options?: MachineFetchErrorOptions);
}
/** The payment exceeds `maxPayment`, or its asset has no `maxPayment` entry. */
export declare class LimitExceededError extends PaymentPolicyError {
    readonly name: string;
    constructor(shortMessage: string, options?: MachineFetchErrorOptions);
}
/**
 * A funder could not prepare the required asset, and no funds moved. Custom funders throw it
 * directly, optionally with their own `hint`.
 */
export declare class FundingError extends MachineFetchError {
    readonly name: string;
    constructor(shortMessage: string, options?: MachineFetchErrorOptions & Readonly<{
        hint?: string | undefined;
    }>);
}
/** No trusted route could acquire the required asset; `cause` preserves quote failures. */
export declare class NoRouteError extends FundingError {
    readonly name: string;
    constructor(shortMessage: string, options?: MachineFetchErrorOptions);
}
/** The configured account does not have enough spendable balance. */
export declare class InsufficientFundsError extends FundingError {
    readonly name: string;
    constructor(shortMessage: string, options?: MachineFetchErrorOptions);
}
/** Funding may have moved assets; reconcile `operationId` before retrying under a new one. */
export declare class FundingRecoveryError extends FundingError {
    readonly name: string;
    /** Identity of the ambiguous funding operation. */
    readonly operationId: string;
    /** Provider reference of a submitted operation, when one is known. */
    readonly reference: string | undefined;
    constructor(operationId: string, options?: MachineFetchErrorOptions & Readonly<{
        message?: string | undefined;
        reference?: string | undefined;
    }>);
}
/** An operation store rejected a read or write; never treat this as an absent operation. */
export declare class OperationStoreError extends MachineFetchError {
    readonly name: string;
    constructor(shortMessage: string, options?: MachineFetchErrorOptions);
}
/** {@link MachineFetchError} narrowed by `name`; machine-fetch throws only its subclasses. */
export type BaseErrorType = MachineFetchError & {
    name: 'Errors.BaseError';
};
/** {@link DisposedError} narrowed by `name`. */
export type DisposedErrorType = DisposedError & {
    name: 'MachineFetch.DisposedError';
};
/** {@link InvalidConfigurationError} narrowed by `name`. */
export type InvalidConfigurationErrorType = InvalidConfigurationError & {
    name: 'Errors.InvalidConfigurationError';
};
/** {@link InvalidPaymentError} narrowed by `name`. */
export type InvalidPaymentErrorType = InvalidPaymentError & {
    name: 'Policy.InvalidPaymentError';
};
/** {@link LimitExceededError} narrowed by `name`. */
export type LimitExceededErrorType = LimitExceededError & {
    name: 'Policy.LimitExceededError';
};
/** {@link FundingError} narrowed by `name`. */
export type FundingErrorType = FundingError & {
    name: 'Funder.FundingError';
};
/** {@link NoRouteError} narrowed by `name`. */
export type NoRouteErrorType = NoRouteError & {
    name: 'Funder.NoRouteError';
};
/** {@link InsufficientFundsError} narrowed by `name`. */
export type InsufficientFundsErrorType = InsufficientFundsError & {
    name: 'Funder.InsufficientFundsError';
};
/** {@link FundingRecoveryError} narrowed by `name`. */
export type FundingRecoveryErrorType = FundingRecoveryError & {
    name: 'Funder.FundingRecoveryError';
};
/** {@link OperationStoreError} narrowed by `name`. */
export type OperationStoreErrorType = OperationStoreError & {
    name: 'Errors.OperationStoreError';
};
/**
 * Every error machine-fetch raises, discriminated by `name`. A paid request can also
 * reject with upstream errors from Fetch, the protocol client, or a funder, so keep a default branch.
 */
export type MachineFetchErrorType = DisposedErrorType | InvalidConfigurationErrorType | InvalidPaymentErrorType | LimitExceededErrorType | FundingErrorType | NoRouteErrorType | InsufficientFundsErrorType | FundingRecoveryErrorType | OperationStoreErrorType;
/**
 * Any other error a call can reject with, such as a Fetch `TypeError` or an upstream protocol
 * error. Narrow known machine-fetch errors first.
 */
export type GlobalErrorType<name extends string = 'Error'> = Error & {
    name: name;
};
