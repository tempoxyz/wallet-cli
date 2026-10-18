/** Base error for machine-fetch failures; branch on `code`, not on the message. */
export class MachineFetchError extends Error {
    name = 'MachineFetchError';
    code;
    constructor(message, options) {
        super(message, { cause: options.cause });
        this.code = options.code;
    }
}
/** A payment or configuration was rejected by local safety policy before any funds moved. */
export class PaymentPolicyError extends MachineFetchError {
    name = 'PaymentPolicyError';
    constructor(message, options) {
        super(message, options);
    }
}
/** A funder could not prepare the required asset. `code` defaults to FUNDING_FAILED. */
export class FundingError extends MachineFetchError {
    name = 'FundingError';
    constructor(message, options = {}) {
        super(message, { cause: options.cause, code: options.code ?? 'FUNDING_FAILED' });
    }
}
/** No trusted route could acquire the required asset; `cause` preserves quote failures. */
export class NoRouteError extends FundingError {
    name = 'NoRouteError';
    constructor(message, options = {}) {
        super(message, { cause: options.cause, code: 'NO_ROUTE' });
    }
}
/** The configured account does not have enough spendable balance. */
export class InsufficientFundsError extends FundingError {
    name = 'InsufficientFundsError';
    constructor(message, options = {}) {
        super(message, { cause: options.cause, code: 'INSUFFICIENT_FUNDS' });
    }
}
/** Funding may have moved assets; reconcile `operationId` before retrying under a new one. */
export class FundingRecoveryError extends FundingError {
    name = 'FundingRecoveryError';
    /** Identity of the ambiguous funding operation. */
    operationId;
    /** Provider reference of a submitted operation, when one is known. */
    reference;
    constructor(operationId, options = {}) {
        super(options.message ??
            `Funding state is ambiguous; reconcile operation ${operationId} before retrying`, { cause: options.cause, code: 'RECOVERY_REQUIRED' });
        this.operationId = operationId;
        this.reference = options.reference;
    }
}
/** An operation store rejected a read or write; never treat this as an absent operation. */
export class OperationStoreError extends MachineFetchError {
    name = 'OperationStoreError';
    constructor(message, options = {}) {
        super(message, { cause: options.cause, code: 'STORE_FAILED' });
    }
}
//# sourceMappingURL=errors.js.map