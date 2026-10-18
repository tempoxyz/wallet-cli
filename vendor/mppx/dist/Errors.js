/** Default hint messages for payment errors. */
export const Hints = {
    paymentRequired: 'Use a supported wallet to pay for this resource using one of the supported payment methods returned in the WWW-Authenticate header. See https://mpp.dev/tools/wallet.md',
    malformedCredential: 'Use a supported wallet to construct valid credentials for one of the supported payment methods returned in the WWW-Authenticate header. See https://mpp.dev/tools/wallet.md',
    methodUnsupported: 'Use a supported wallet to pay for this resource using one of the supported payment methods returned in the WWW-Authenticate header. See https://mpp.dev/tools/wallet.md',
};
/**
 * Base class for all payment-related errors.
 */
export class PaymentError extends Error {
    /** Safe method-specific context for diagnostics and relay responses. */
    details;
    /** HTTP status code. */
    status = 402;
    /** Actionable hint for resolving the error (RFC 9457 extension member). */
    hint;
    constructor(message, options = {}) {
        super(message);
        this.details = options.details;
    }
    /** Converts the error to RFC 9457 Problem Details format. */
    toProblemDetails(challengeId) {
        return {
            type: this.type,
            title: this.title,
            status: this.status,
            detail: this.message,
            ...(this.details && Object.keys(this.details).length > 0 && { details: this.details }),
            ...(this.hint && { hint: this.hint }),
            ...(challengeId && { challengeId }),
        };
    }
}
/**
 * Credential is malformed (invalid base64url, bad JSON structure).
 */
export class MalformedCredentialError extends PaymentError {
    name = 'MalformedCredentialError';
    title = 'Malformed Credential';
    status = 402;
    type = 'https://paymentauth.org/problems/malformed-credential';
    hint = Hints.malformedCredential;
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Credential is malformed: ${reason}.` : 'Credential is malformed.');
    }
}
/**
 * Challenge ID is unknown, expired, or already used.
 */
export class InvalidChallengeError extends PaymentError {
    name = 'InvalidChallengeError';
    title = 'Invalid Challenge';
    status = 402;
    type = 'https://paymentauth.org/problems/invalid-challenge';
    constructor(options = {}) {
        const { id, reason } = options;
        const idPart = id ? ` "${id}"` : '';
        const reasonPart = reason ? `: ${reason}` : '';
        super(`Challenge${idPart} is invalid${reasonPart}.`);
    }
}
/**
 * Payment proof is invalid or verification failed.
 */
export class VerificationFailedError extends PaymentError {
    name = 'VerificationFailedError';
    title = 'Verification Failed';
    type = 'https://paymentauth.org/problems/verification-failed';
    constructor(options = {}) {
        const { details, reason } = options;
        super(reason ? `Payment verification failed: ${reason}.` : 'Payment verification failed.', {
            details,
        });
    }
}
/**
 * Payment processing failed because of an unexpected internal error.
 */
export class InternalPaymentError extends PaymentError {
    name = 'InternalPaymentError';
    title = 'Internal Payment Error';
    status = 500;
    type = 'https://paymentauth.org/problems/internal-payment-error';
    constructor() {
        super('An internal payment error occurred.');
    }
}
/**
 * Payment requires additional action (e.g., 3DS authentication).
 */
export class PaymentActionRequiredError extends PaymentError {
    name = 'PaymentActionRequiredError';
    title = 'Payment Action Required';
    type = 'https://paymentauth.org/problems/payment-action-required';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Payment requires action: ${reason}.` : 'Payment requires action.');
    }
}
/**
 * Payment has expired.
 */
export class PaymentExpiredError extends PaymentError {
    name = 'PaymentExpiredError';
    title = 'Payment Expired';
    type = 'https://paymentauth.org/problems/payment-expired';
    constructor(options = {}) {
        const { expires } = options;
        super(expires ? `Payment expired at ${expires}.` : 'Payment has expired.');
    }
}
/**
 * No credential was provided but payment is required.
 */
export class PaymentRequiredError extends PaymentError {
    name = 'PaymentRequiredError';
    title = 'Payment Required';
    type = 'https://paymentauth.org/problems/payment-required';
    hint = Hints.paymentRequired;
    constructor(options = {}) {
        const { description } = options;
        const parts = ['Payment is required'];
        if (description)
            parts.push(`(${description})`);
        super(`${parts.join(' ')}.`);
    }
}
/**
 * Credential payload does not match the expected schema.
 */
export class InvalidPayloadError extends PaymentError {
    name = 'InvalidPayloadError';
    title = 'Invalid Payload';
    type = 'https://paymentauth.org/problems/invalid-payload';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Credential payload is invalid: ${reason}.` : 'Credential payload is invalid.');
    }
}
/**
 * Request is malformed or contains invalid parameters.
 */
export class BadRequestError extends PaymentError {
    name = 'BadRequestError';
    title = 'Bad Request';
    status = 400;
    type = 'https://paymentauth.org/problems/bad-request';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Bad request: ${reason}.` : 'Bad request.');
    }
}
/**
 * Payment amount is insufficient (too low).
 */
export class PaymentInsufficientError extends PaymentError {
    name = 'PaymentInsufficientError';
    title = 'Payment Insufficient';
    type = 'https://paymentauth.org/problems/payment-insufficient';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Payment insufficient: ${reason}.` : 'Payment amount is insufficient.');
    }
}
/**
 * Payment method is not supported by the server.
 */
export class PaymentMethodUnsupportedError extends PaymentError {
    name = 'PaymentMethodUnsupportedError';
    title = 'Method Unsupported';
    status = 400;
    type = 'https://paymentauth.org/problems/method-unsupported';
    hint = Hints.methodUnsupported;
    constructor(options = {}) {
        const { method } = options;
        super(method ? `Payment method "${method}" is not supported.` : 'Payment method is not supported.');
    }
}
/**
 * Insufficient balance in the payment channel.
 */
export class InsufficientBalanceError extends PaymentError {
    name = 'InsufficientBalanceError';
    title = 'Insufficient Balance';
    status = 402;
    type = 'https://paymentauth.org/problems/session/insufficient-balance';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Insufficient balance: ${reason}.` : 'Insufficient balance.');
    }
}
/**
 * Voucher or close request signature is invalid.
 */
export class InvalidSignatureError extends PaymentError {
    name = 'InvalidSignatureError';
    title = 'Invalid Signature';
    status = 402;
    type = 'https://paymentauth.org/problems/session/invalid-signature';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Invalid signature: ${reason}.` : 'Invalid signature.');
    }
}
/**
 * Recovered signer is not authorized for this channel.
 */
export class SignerMismatchError extends PaymentError {
    name = 'SignerMismatchError';
    title = 'Signer Mismatch';
    status = 402;
    type = 'https://paymentauth.org/problems/session/signer-mismatch';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Signer mismatch: ${reason}.` : 'Signer is not authorized for this channel.');
    }
}
/**
 * Voucher cumulative amount exceeds the channel deposit.
 */
export class AmountExceedsDepositError extends PaymentError {
    name = 'AmountExceedsDepositError';
    title = 'Amount Exceeds Deposit';
    status = 402;
    type = 'https://paymentauth.org/problems/session/amount-exceeds-deposit';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Amount exceeds deposit: ${reason}.` : 'Voucher amount exceeds channel deposit.');
    }
}
/**
 * Voucher amount increase is below the minimum delta.
 */
export class DeltaTooSmallError extends PaymentError {
    name = 'DeltaTooSmallError';
    title = 'Delta Too Small';
    status = 402;
    type = 'https://paymentauth.org/problems/session/delta-too-small';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Delta too small: ${reason}.` : 'Amount increase below minimum voucher delta.');
    }
}
/**
 * No channel with this ID exists.
 */
export class ChannelNotFoundError extends PaymentError {
    name = 'ChannelNotFoundError';
    title = 'Channel Not Found';
    status = 410;
    type = 'https://paymentauth.org/problems/session/channel-not-found';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Channel not found: ${reason}.` : 'No channel with this ID exists.');
    }
}
/**
 * Channel is closed or finalized.
 */
export class ChannelClosedError extends PaymentError {
    name = 'ChannelClosedError';
    title = 'Channel Closed';
    status = 410;
    type = 'https://paymentauth.org/problems/session/channel-finalized';
    constructor(options = {}) {
        const { reason } = options;
        super(reason ? `Channel closed: ${reason}.` : 'Channel is closed.');
    }
}
//# sourceMappingURL=Errors.js.map