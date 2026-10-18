/** Default hint messages for payment errors. */
export declare const Hints: {
    readonly paymentRequired: 'Use a supported wallet to pay for this resource using one of the supported payment methods returned in the WWW-Authenticate header. See https://mpp.dev/tools/wallet.md';
    readonly malformedCredential: 'Use a supported wallet to construct valid credentials for one of the supported payment methods returned in the WWW-Authenticate header. See https://mpp.dev/tools/wallet.md';
    readonly methodUnsupported: 'Use a supported wallet to pay for this resource using one of the supported payment methods returned in the WWW-Authenticate header. See https://mpp.dev/tools/wallet.md';
};
/**
 * Base class for all payment-related errors.
 */
export declare abstract class PaymentError extends Error {
    /** Safe method-specific context for diagnostics and relay responses. */
    readonly details: Readonly<Record<string, unknown>> | undefined;
    /** RFC 9457 Problem Details type URI. */
    abstract readonly type: string;
    /** Human-readable summary for RFC 9457 Problem Details. */
    abstract readonly title: string;
    /** HTTP status code. */
    readonly status: number;
    /** Actionable hint for resolving the error (RFC 9457 extension member). */
    readonly hint: string | undefined;
    protected constructor(message: string, options?: PaymentError.Options);
    /** Converts the error to RFC 9457 Problem Details format. */
    toProblemDetails(challengeId?: string): PaymentError.ProblemDetails;
}
export declare namespace PaymentError {
    type Options = {
        details?: Record<string, unknown> | undefined;
    };
    type ProblemDetails = {
        /** RFC 9457 Problem Details type URI. */
        type: string;
        /** Human-readable summary. */
        title: string;
        /** HTTP status code. */
        status: number;
        /** Human-readable explanation. */
        detail: string;
        /** Safe method-specific diagnostic context. */
        details?: Readonly<Record<string, unknown>>;
        /** Actionable hint for resolving the error (RFC 9457 extension member). */
        hint?: string;
        /** Associated challenge ID, if applicable. */
        challengeId?: string;
    };
}
/**
 * Credential is malformed (invalid base64url, bad JSON structure).
 */
export declare class MalformedCredentialError extends PaymentError {
    readonly name = "MalformedCredentialError";
    readonly title = "Malformed Credential";
    readonly status = 402;
    readonly type = "https://paymentauth.org/problems/malformed-credential";
    readonly hint: "Use a supported wallet to construct valid credentials for one of the supported payment methods returned in the WWW-Authenticate header. See https://mpp.dev/tools/wallet.md";
    constructor(options?: MalformedCredentialError.Options);
}
export declare namespace MalformedCredentialError {
    type Options = {
        /** Reason the credential is malformed (e.g., "invalid base64url", "invalid JSON"). */
        reason?: string;
    };
}
/**
 * Challenge ID is unknown, expired, or already used.
 */
export declare class InvalidChallengeError extends PaymentError {
    readonly name = "InvalidChallengeError";
    readonly title = "Invalid Challenge";
    readonly status = 402;
    readonly type = "https://paymentauth.org/problems/invalid-challenge";
    constructor(options?: InvalidChallengeError.Options);
}
export declare namespace InvalidChallengeError {
    type Options = {
        /** The invalid challenge ID. */
        id?: string;
        /** Reason the challenge is invalid (e.g., "expired", "already used", "unknown"). */
        reason?: string;
    };
}
/**
 * Payment proof is invalid or verification failed.
 */
export declare class VerificationFailedError extends PaymentError {
    readonly name = "VerificationFailedError";
    readonly title = "Verification Failed";
    readonly type = "https://paymentauth.org/problems/verification-failed";
    constructor(options?: VerificationFailedError.Options);
}
export declare namespace VerificationFailedError {
    type Options = {
        /** Safe method-specific diagnostic context. */
        details?: Record<string, unknown> | undefined;
        /** Reason verification failed (e.g., "invalid signature", "insufficient amount"). */
        reason?: string;
    };
}
/**
 * Payment processing failed because of an unexpected internal error.
 */
export declare class InternalPaymentError extends PaymentError {
    readonly name = "InternalPaymentError";
    readonly title = "Internal Payment Error";
    readonly status = 500;
    readonly type = "https://paymentauth.org/problems/internal-payment-error";
    constructor();
}
/**
 * Payment requires additional action (e.g., 3DS authentication).
 */
export declare class PaymentActionRequiredError extends PaymentError {
    readonly name = "PaymentActionRequiredError";
    readonly title = "Payment Action Required";
    readonly type = "https://paymentauth.org/problems/payment-action-required";
    constructor(options?: PaymentActionRequiredError.Options);
}
export declare namespace PaymentActionRequiredError {
    type Options = {
        /** Reason action is required (e.g., "requires_action"). */
        reason?: string;
    };
}
/**
 * Payment has expired.
 */
export declare class PaymentExpiredError extends PaymentError {
    readonly name = "PaymentExpiredError";
    readonly title = "Payment Expired";
    readonly type = "https://paymentauth.org/problems/payment-expired";
    constructor(options?: PaymentExpiredError.Options);
}
export declare namespace PaymentExpiredError {
    type Options = {
        /** ISO 8601 expiration timestamp. */
        expires?: string;
    };
}
/**
 * No credential was provided but payment is required.
 */
export declare class PaymentRequiredError extends PaymentError {
    readonly name = "PaymentRequiredError";
    readonly title = "Payment Required";
    readonly type = "https://paymentauth.org/problems/payment-required";
    readonly hint: "Use a supported wallet to pay for this resource using one of the supported payment methods returned in the WWW-Authenticate header. See https://mpp.dev/tools/wallet.md";
    constructor(options?: PaymentRequiredError.Options);
}
export declare namespace PaymentRequiredError {
    type Options = {
        /** Human-readable description of the payment. */
        description?: string | undefined;
    };
}
/**
 * Credential payload does not match the expected schema.
 */
export declare class InvalidPayloadError extends PaymentError {
    readonly name = "InvalidPayloadError";
    readonly title = "Invalid Payload";
    readonly type = "https://paymentauth.org/problems/invalid-payload";
    constructor(options?: InvalidPayloadError.Options);
}
export declare namespace InvalidPayloadError {
    type Options = {
        /** Reason the payload is invalid (e.g., "missing signature field"). */
        reason?: string;
    };
}
/**
 * Request is malformed or contains invalid parameters.
 */
export declare class BadRequestError extends PaymentError {
    readonly name = "BadRequestError";
    readonly title = "Bad Request";
    readonly status = 400;
    readonly type = "https://paymentauth.org/problems/bad-request";
    constructor(options?: BadRequestError.Options);
}
export declare namespace BadRequestError {
    type Options = {
        /** Reason the request is invalid. */
        reason?: string;
    };
}
/**
 * Payment amount is insufficient (too low).
 */
export declare class PaymentInsufficientError extends PaymentError {
    readonly name = "PaymentInsufficientError";
    readonly title = "Payment Insufficient";
    readonly type = "https://paymentauth.org/problems/payment-insufficient";
    constructor(options?: PaymentInsufficientError.Options);
}
export declare namespace PaymentInsufficientError {
    type Options = {
        /** Reason the payment is insufficient (e.g., "expected 1000, received 500"). */
        reason?: string;
    };
}
/**
 * Payment method is not supported by the server.
 */
export declare class PaymentMethodUnsupportedError extends PaymentError {
    readonly name = "PaymentMethodUnsupportedError";
    readonly title = "Method Unsupported";
    readonly status = 400;
    readonly type = "https://paymentauth.org/problems/method-unsupported";
    readonly hint: "Use a supported wallet to pay for this resource using one of the supported payment methods returned in the WWW-Authenticate header. See https://mpp.dev/tools/wallet.md";
    constructor(options?: PaymentMethodUnsupportedError.Options);
}
export declare namespace PaymentMethodUnsupportedError {
    type Options = {
        /** The unsupported method identifier. */
        method?: string;
    };
}
/**
 * Insufficient balance in the payment channel.
 */
export declare class InsufficientBalanceError extends PaymentError {
    readonly name = "InsufficientBalanceError";
    readonly title = "Insufficient Balance";
    readonly status = 402;
    readonly type = "https://paymentauth.org/problems/session/insufficient-balance";
    constructor(options?: InsufficientBalanceError.Options);
}
export declare namespace InsufficientBalanceError {
    type Options = {
        /** Reason for insufficient balance. */
        reason?: string;
    };
}
/**
 * Voucher or close request signature is invalid.
 */
export declare class InvalidSignatureError extends PaymentError {
    readonly name = "InvalidSignatureError";
    readonly title = "Invalid Signature";
    readonly status = 402;
    readonly type = "https://paymentauth.org/problems/session/invalid-signature";
    constructor(options?: InvalidSignatureError.Options);
}
export declare namespace InvalidSignatureError {
    type Options = {
        reason?: string;
    };
}
/**
 * Recovered signer is not authorized for this channel.
 */
export declare class SignerMismatchError extends PaymentError {
    readonly name = "SignerMismatchError";
    readonly title = "Signer Mismatch";
    readonly status = 402;
    readonly type = "https://paymentauth.org/problems/session/signer-mismatch";
    constructor(options?: SignerMismatchError.Options);
}
export declare namespace SignerMismatchError {
    type Options = {
        reason?: string;
    };
}
/**
 * Voucher cumulative amount exceeds the channel deposit.
 */
export declare class AmountExceedsDepositError extends PaymentError {
    readonly name = "AmountExceedsDepositError";
    readonly title = "Amount Exceeds Deposit";
    readonly status = 402;
    readonly type = "https://paymentauth.org/problems/session/amount-exceeds-deposit";
    constructor(options?: AmountExceedsDepositError.Options);
}
export declare namespace AmountExceedsDepositError {
    type Options = {
        reason?: string;
    };
}
/**
 * Voucher amount increase is below the minimum delta.
 */
export declare class DeltaTooSmallError extends PaymentError {
    readonly name = "DeltaTooSmallError";
    readonly title = "Delta Too Small";
    readonly status = 402;
    readonly type = "https://paymentauth.org/problems/session/delta-too-small";
    constructor(options?: DeltaTooSmallError.Options);
}
export declare namespace DeltaTooSmallError {
    type Options = {
        reason?: string;
    };
}
/**
 * No channel with this ID exists.
 */
export declare class ChannelNotFoundError extends PaymentError {
    readonly name = "ChannelNotFoundError";
    readonly title = "Channel Not Found";
    readonly status = 410;
    readonly type = "https://paymentauth.org/problems/session/channel-not-found";
    constructor(options?: ChannelNotFoundError.Options);
}
export declare namespace ChannelNotFoundError {
    type Options = {
        reason?: string;
    };
}
/**
 * Channel is closed or finalized.
 */
export declare class ChannelClosedError extends PaymentError {
    readonly name = "ChannelClosedError";
    readonly title = "Channel Closed";
    readonly status = 410;
    readonly type = "https://paymentauth.org/problems/session/channel-finalized";
    constructor(options?: ChannelClosedError.Options);
}
export declare namespace ChannelClosedError {
    type Options = {
        /** Reason the channel is closed. */
        reason?: string;
    };
}
//# sourceMappingURL=Errors.d.ts.map