import * as Errors from './Errors.js';
/** MCP JSON-RPC error code for payment required. */
export const paymentRequiredCode = -32042;
/** MCP JSON-RPC error code for payment verification failed. */
export const paymentVerificationFailedCode = -32043;
/** JSON-RPC error code for invalid parameters. */
export const invalidParamsCode = -32602;
/** JSON-RPC error code for internal errors. */
export const internalErrorCode = -32603;
/**
 * Maps a payment error to its MCP JSON-RPC error code.
 */
export function errorCode(error) {
    if (!error || error instanceof Errors.PaymentRequiredError)
        return paymentRequiredCode;
    if (error instanceof Errors.MalformedCredentialError ||
        error instanceof Errors.InvalidPayloadError)
        return invalidParamsCode;
    if (error instanceof Errors.InternalPaymentError)
        return internalErrorCode;
    return paymentVerificationFailedCode;
}
/** MCP metadata key for credentials. */
export const credentialMetaKey = 'org.paymentauth/credential';
/** MCP metadata key for payment-required tool results. */
export const paymentRequiredMetaKey = 'org.paymentauth/payment-required';
/** MCP metadata key for receipts. */
export const receiptMetaKey = 'org.paymentauth/receipt';
//# sourceMappingURL=Mcp.js.map