import { Base64 } from 'ox';
import * as HeaderCodec from '../internal/HeaderCodec.js';
import { ExtensionsSchema, PaymentPayloadSchema, PaymentRequiredSchema, ResourceInfoSchema, SettleResponseSchema, } from './Types.js';
const paymentRequired = HeaderCodec.createJson(PaymentRequiredSchema);
const paymentSignature = HeaderCodec.createJson(PaymentPayloadSchema);
const paymentResponse = HeaderCodec.createJson(SettleResponseSchema);
/** Encodes an x402 payment-required object for the `PAYMENT-REQUIRED` header. */
export const encodePaymentRequired = paymentRequired.encode;
/** Decodes an x402 `PAYMENT-REQUIRED` header value. */
export const decodePaymentRequired = paymentRequired.decode;
/** Decodes only the x402 `PAYMENT-REQUIRED` envelope, leaving accepts unvalidated. @internal */
export function decodePaymentRequiredEnvelope(value) {
    try {
        const parsed = JSON.parse(Base64.toString(value));
        return parsePaymentRequiredEnvelope(parsed);
    }
    catch {
        throw new HeaderCodec.InvalidJsonHeaderError();
    }
}
/** Encodes an x402 payment payload for the `PAYMENT-SIGNATURE` header. */
export const encodePaymentSignature = paymentSignature.encode;
/** Decodes an x402 `PAYMENT-SIGNATURE` header value. */
export const decodePaymentSignature = paymentSignature.decode;
/** Encodes an x402 settlement response for the `PAYMENT-RESPONSE` header. */
export const encodePaymentResponse = paymentResponse.encode;
/** Decodes an x402 `PAYMENT-RESPONSE` header value. */
export const decodePaymentResponse = paymentResponse.decode;
const parsePaymentRequiredEnvelope = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new HeaderCodec.InvalidJsonHeaderError();
    const record = value;
    if (record.x402Version !== 2 || !Array.isArray(record.accepts))
        throw new HeaderCodec.InvalidJsonHeaderError();
    const resource = ResourceInfoSchema.parse(record.resource);
    const extensions = record.extensions !== undefined ? ExtensionsSchema.safeParse(record.extensions).data : undefined;
    return {
        accepts: record.accepts,
        ...(extensions ? { extensions } : {}),
        resource,
        x402Version: 2,
    };
};
//# sourceMappingURL=Header.js.map