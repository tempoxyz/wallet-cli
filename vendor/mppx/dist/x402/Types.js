import * as z from '../zod.js';
export const versions = [2];
/** mppx method name used for EVM charge challenges backed by x402. */
export const paymentMethod = 'evm';
/** mppx intent name used for EVM charge challenges backed by x402 exact. */
export const exactIntent = 'charge';
export const schemes = ['exact'];
export const assetTransferMethods = ['eip3009', 'permit2'];
/** CAIP-2 namespace prefix for EVM networks. */
export const evmNetworkPrefix = 'eip155:';
/** Prefix for synthetic mppx challenge IDs derived from x402 `accepts` entries. */
export const syntheticChallengeIdPrefix = 'x402:';
/** HTTP header carrying a base64-encoded x402 payment-required response. */
export const paymentRequiredHeader = 'PAYMENT-REQUIRED';
/** HTTP header carrying a base64-encoded x402 payment payload. */
export const paymentSignatureHeader = 'PAYMENT-SIGNATURE';
/** Legacy HTTP header carrying an x402 v1 payment payload. */
export const legacyPaymentSignatureHeader = 'X-PAYMENT';
/** HTTP header carrying a base64-encoded x402 settlement response. */
export const paymentResponseHeader = 'PAYMENT-RESPONSE';
const nonEmptyString = z.string().check(z.minLength(1));
const positiveNumber = z.number().check(z.refine((value) => value > 0, 'Must be positive'));
const atomicAmount = z.string().check(z.regex(/^\d+$/, 'Invalid atomic amount'));
const address = z.address();
const evmNetwork = z
    .string()
    .check(z.regex(new RegExp(`^${evmNetworkPrefix}\\d+$`), 'Invalid EVM CAIP-2 network'));
/** Describes the protected resource in x402 v2 payment-required responses. */
export const ResourceInfoSchema = z.object({
    description: z.optional(z.string()),
    iconUrl: z.optional(z.string()),
    mimeType: z.optional(z.string()),
    serviceName: z.optional(z.string()),
    tags: z.optional(z.array(z.string())),
    url: nonEmptyString,
});
/** Public transfer configuration for exact EVM payments. */
export const ExactTransferSchema = z.discriminatedUnion('type', [
    z.object({
        name: nonEmptyString,
        type: z.literal('eip3009'),
        version: nonEmptyString,
    }),
    z.object({
        name: z.optional(z.string()),
        type: z.literal('permit2'),
        version: z.optional(z.string()),
    }),
]);
/** x402 v2 payment requirements for the `exact` scheme. */
export const PaymentRequirementsSchema = z.object({
    amount: atomicAmount,
    asset: nonEmptyString,
    extra: z.optional(z.record(z.string(), z.unknown())),
    maxTimeoutSeconds: positiveNumber,
    network: evmNetwork,
    payTo: nonEmptyString,
    scheme: z.enum(schemes),
});
/** x402 v2 protocol extension value. */
export const ExtensionSchema = z.object({
    info: z.record(z.string(), z.unknown()),
    schema: z.record(z.string(), z.unknown()),
});
/** x402 v2 protocol extensions map. */
export const ExtensionsSchema = z.record(z.string(), ExtensionSchema);
/** x402 v2 payment-required response. */
export const PaymentRequiredSchema = z.object({
    accepts: z.array(PaymentRequirementsSchema).check(z.minLength(1)),
    error: z.optional(z.string()),
    extensions: z.optional(ExtensionsSchema),
    resource: ResourceInfoSchema,
    x402Version: z.literal(2),
});
/** EIP-3009 transferWithAuthorization payload for exact EVM payments. */
export const ExactEip3009PayloadSchema = z.object({
    authorization: z.object({
        from: address,
        nonce: z.hash(),
        to: address,
        validAfter: atomicAmount,
        validBefore: atomicAmount,
        value: atomicAmount,
    }),
    signature: z.signature(),
});
/** Permit2 payload for exact EVM payments. */
export const ExactPermit2PayloadSchema = z.object({
    permit2Authorization: z.object({
        deadline: atomicAmount,
        from: address,
        nonce: atomicAmount,
        permitted: z.object({
            amount: atomicAmount,
            token: address,
        }),
        spender: address,
        witness: z.object({
            to: address,
            validAfter: atomicAmount,
        }),
    }),
    signature: z.signature(),
});
/** Exact EVM payment payload body. */
export const ExactPayloadSchema = z.union([ExactEip3009PayloadSchema, ExactPermit2PayloadSchema]);
/** x402 v2 payment payload. */
export const PaymentPayloadSchema = z.object({
    accepted: PaymentRequirementsSchema,
    extensions: z.optional(ExtensionsSchema),
    payload: ExactPayloadSchema,
    resource: z.optional(ResourceInfoSchema),
    x402Version: z.literal(2),
});
/** Facilitator verification response. */
export const VerifyResponseSchema = z.object({
    extensions: z.optional(ExtensionsSchema),
    extra: z.optional(z.record(z.string(), z.unknown())),
    invalidMessage: z.optional(z.string()),
    invalidReason: z.optional(z.string()),
    isValid: z.boolean(),
    payer: z.optional(z.string()),
});
/** Facilitator settlement response and x402 `PAYMENT-RESPONSE` body. */
export const SettleResponseSchema = z.object({
    amount: z.optional(atomicAmount),
    errorMessage: z.optional(z.string()),
    errorReason: z.optional(z.string()),
    extensions: z.optional(ExtensionsSchema),
    extra: z.optional(z.record(z.string(), z.unknown())),
    network: nonEmptyString,
    payer: z.optional(z.string()),
    success: z.boolean(),
    transaction: z.string(),
});
/** Extracts x402 `PaymentRequirements` from a canonical exact request. */
export function toPaymentRequirements(request) {
    const { extensions: _extensions, resource: _resource, ...paymentRequirements } = request;
    return PaymentRequirementsSchema.parse(paymentRequirements);
}
//# sourceMappingURL=Types.js.map