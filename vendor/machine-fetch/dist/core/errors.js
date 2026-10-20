/** Where every error, and what to do about it, is documented. */
const ERRORS_DOCS_URL = 'https://github.com/tempoxyz/machine-fetch#typed-errors';
/**
 * Base error for machine-fetch failures. Narrow with `instanceof` or on the namespaced `name`,
 * never on the message. `shortMessage` is the one-line summary; `message` adds context, a hint,
 * and a link to the error reference.
 */
export class MachineFetchError extends Error {
    name = 'Errors.BaseError';
    /** One-line summary, without context, hint, or docs link. */
    shortMessage;
    /** Bounded diagnostic detail, when the thrower supplied it. */
    details;
    /** Extra context lines. */
    metaMessages;
    /** The next step to resolve the failure. */
    hint;
    /** Reference for every error class. */
    docsUrl = ERRORS_DOCS_URL;
    constructor(shortMessage, options = {}) {
        super([
            shortMessage,
            ...(options.metaMessages?.length ? ['', ...options.metaMessages] : []),
            '',
            ...(options.hint ? [`Hint: ${options.hint}`] : []),
            `Docs: ${ERRORS_DOCS_URL}`,
            ...(options.details ? [`Details: ${options.details}`] : []),
        ].join('\n'), { cause: options.cause });
        this.shortMessage = shortMessage;
        this.details = options.details;
        this.metaMessages = options.metaMessages;
        this.hint = options.hint;
    }
    walk(match) {
        let error = this;
        for (;;) {
            if (match?.(error))
                return error;
            const cause = error instanceof Error ? error.cause : undefined;
            if (cause === undefined)
                return match ? undefined : error;
            error = cause;
        }
    }
}
/** A disposed payment wrapper or x402 binding was called. */
export class DisposedError extends MachineFetchError {
    name = 'MachineFetch.DisposedError';
    constructor(shortMessage, options = {}) {
        super(shortMessage, { ...options, hint: 'Create a new client.' });
    }
}
/** Options are invalid, or an API is misused. Raised before any funds move. */
export class InvalidConfigurationError extends MachineFetchError {
    name = 'Errors.InvalidConfigurationError';
    constructor(shortMessage, options = {}) {
        super(shortMessage, { ...options, hint: 'Fix the options or API usage.' });
    }
}
/** A payment was rejected by local safety policy before anything was signed or any funds moved. */
export class PaymentPolicyError extends MachineFetchError {
    // Stryker disable next-line StringLiteral: the class is abstract, so every instance overrides it.
    name = 'Policy.PaymentPolicyError';
}
/** The payment challenge is malformed, or a `Money` limit has no token metadata to compare. */
export class InvalidPaymentError extends PaymentPolicyError {
    name = 'Policy.InvalidPaymentError';
    constructor(shortMessage, options = {}) {
        super(shortMessage, {
            ...options,
            hint: 'The server sent a challenge that cannot be evaluated; do not pay it.',
        });
    }
}
/** The payment exceeds `maxPayment`, or its asset has no `maxPayment` entry. */
export class LimitExceededError extends PaymentPolicyError {
    name = 'Policy.LimitExceededError';
    constructor(shortMessage, options = {}) {
        super(shortMessage, { ...options, hint: 'Raise `maxPayment`, or skip the request.' });
    }
}
/**
 * A funder could not prepare the required asset, and no funds moved. Custom funders throw it
 * directly, optionally with their own `hint`.
 */
export class FundingError extends MachineFetchError {
    name = 'Funder.FundingError';
    constructor(shortMessage, options = {}) {
        super(shortMessage, { ...options, hint: options.hint ?? 'Retry under the same operation ID.' });
    }
}
/** No trusted route could acquire the required asset; `cause` preserves quote failures. */
export class NoRouteError extends FundingError {
    name = 'Funder.NoRouteError';
    constructor(shortMessage, options = {}) {
        super(shortMessage, { ...options, hint: 'Add a funder or route for the payment token.' });
    }
}
/** The configured account does not have enough spendable balance. */
export class InsufficientFundsError extends FundingError {
    name = 'Funder.InsufficientFundsError';
    constructor(shortMessage, options = {}) {
        super(shortMessage, { ...options, hint: "Top up one of the funder's input tokens." });
    }
}
/** Funding may have moved assets; reconcile `operationId` before retrying under a new one. */
export class FundingRecoveryError extends FundingError {
    name = 'Funder.FundingRecoveryError';
    /** Identity of the ambiguous funding operation. */
    operationId;
    /** Provider reference of a submitted operation, when one is known. */
    reference;
    constructor(operationId, options = {}) {
        super(options.message ??
            `Funding state is ambiguous; reconcile operation ${operationId} before retrying`, { ...options, hint: 'Reconcile `error.operationId` before retrying.' });
        this.operationId = operationId;
        this.reference = options.reference;
    }
}
/** An operation store rejected a read or write; never treat this as an absent operation. */
export class OperationStoreError extends MachineFetchError {
    name = 'Errors.OperationStoreError';
    constructor(shortMessage, options = {}) {
        super(shortMessage, {
            ...options,
            hint: 'Fix the store, then retry under the same operation ID.',
        });
    }
}
