import { type Extensions, type PaymentPayload, type PaymentRequired, type ResourceInfo, type SettleResponse, type Version } from './Types.js';
/** Encodes an x402 payment-required object for the `PAYMENT-REQUIRED` header. */
export declare const encodePaymentRequired: (paymentRequired: PaymentRequired) => string;
/** Decodes an x402 `PAYMENT-REQUIRED` header value. */
export declare const decodePaymentRequired: (value: string) => PaymentRequired;
/** Tolerant x402 `PAYMENT-REQUIRED` envelope used before filtering supported accepts. @internal */
export type PaymentRequiredEnvelope = {
    accepts: unknown[];
    extensions?: Extensions | undefined;
    resource: ResourceInfo;
    x402Version: Version;
};
/** Decodes only the x402 `PAYMENT-REQUIRED` envelope, leaving accepts unvalidated. @internal */
export declare function decodePaymentRequiredEnvelope(value: string): PaymentRequiredEnvelope;
/** Encodes an x402 payment payload for the `PAYMENT-SIGNATURE` header. */
export declare const encodePaymentSignature: (paymentPayload: PaymentPayload) => string;
/** Decodes an x402 `PAYMENT-SIGNATURE` header value. */
export declare const decodePaymentSignature: (value: string) => PaymentPayload;
/** Encodes an x402 settlement response for the `PAYMENT-RESPONSE` header. */
export declare const encodePaymentResponse: (paymentResponse: SettleResponse) => string;
/** Decodes an x402 `PAYMENT-RESPONSE` header value. */
export declare const decodePaymentResponse: (value: string) => SettleResponse;
//# sourceMappingURL=Header.d.ts.map