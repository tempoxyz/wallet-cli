import * as z from '../zod.js';
export declare const versions: readonly [2];
/** mppx method name used for EVM charge challenges backed by x402. */
export declare const paymentMethod: 'evm';
/** mppx intent name used for EVM charge challenges backed by x402 exact. */
export declare const exactIntent: 'charge';
export declare const schemes: readonly ['exact'];
export declare const assetTransferMethods: readonly ['eip3009', 'permit2'];
/** CAIP-2 namespace prefix for EVM networks. */
export declare const evmNetworkPrefix: 'eip155:';
/** Prefix for synthetic mppx challenge IDs derived from x402 `accepts` entries. */
export declare const syntheticChallengeIdPrefix: 'x402:';
/** x402 protocol version supported by this package. */
export type Version = 2;
/** mppx payment method name used for EVM charge challenges backed by x402. */
export type PaymentMethod = typeof paymentMethod;
/** mppx intent name used for EVM charge challenges backed by x402 exact. */
export type ExactIntent = typeof exactIntent;
/** x402 scheme supported by this package. */
export type Scheme = (typeof schemes)[number];
/** x402 exact EVM asset transfer method. */
export type AssetTransferMethod = (typeof assetTransferMethods)[number];
/** CAIP-2 EVM network identifier. */
export type EvmNetwork = `${typeof evmNetworkPrefix}${number}`;
/** HTTP header carrying a base64-encoded x402 payment-required response. */
export declare const paymentRequiredHeader = "PAYMENT-REQUIRED";
/** HTTP header carrying a base64-encoded x402 payment payload. */
export declare const paymentSignatureHeader = "PAYMENT-SIGNATURE";
/** Legacy HTTP header carrying an x402 v1 payment payload. */
export declare const legacyPaymentSignatureHeader = "X-PAYMENT";
/** HTTP header carrying a base64-encoded x402 settlement response. */
export declare const paymentResponseHeader = "PAYMENT-RESPONSE";
/** Describes the protected resource in x402 v2 payment-required responses. */
export declare const ResourceInfoSchema: z.ZodMiniObject<{
    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
    iconUrl: z.ZodMiniOptional<z.ZodMiniString<string>>;
    mimeType: z.ZodMiniOptional<z.ZodMiniString<string>>;
    serviceName: z.ZodMiniOptional<z.ZodMiniString<string>>;
    tags: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniString<string>>>;
    url: z.ZodMiniString<string>;
}, z.core.$strip>;
/** Describes the protected resource in x402 v2 payment-required responses. */
export type ResourceInfo = z.infer<typeof ResourceInfoSchema>;
/** Public transfer configuration for exact EVM payments. */
export declare const ExactTransferSchema: z.ZodMiniDiscriminatedUnion<[z.ZodMiniObject<{
    name: z.ZodMiniString<string>;
    type: z.ZodMiniLiteral<"eip3009">;
    version: z.ZodMiniString<string>;
}, z.core.$strip>, z.ZodMiniObject<{
    name: z.ZodMiniOptional<z.ZodMiniString<string>>;
    type: z.ZodMiniLiteral<"permit2">;
    version: z.ZodMiniOptional<z.ZodMiniString<string>>;
}, z.core.$strip>], "type">;
/** Public EIP-3009 transfer configuration for exact EVM payments. */
export type ExactEip3009Transfer = Extract<z.infer<typeof ExactTransferSchema>, {
    type: 'eip3009';
}>;
/** Public Permit2 transfer configuration for exact EVM payments. */
export type ExactPermit2Transfer = Extract<z.infer<typeof ExactTransferSchema>, {
    type: 'permit2';
}>;
/** Public transfer configuration for exact EVM payments. */
export type ExactTransfer = z.infer<typeof ExactTransferSchema>;
/** Known asset metadata used to derive x402 wire `extra` fields. */
export type Asset = {
    address: `0x${string}`;
    decimals: number;
    transfer: ExactTransfer;
};
/** x402 v2 payment requirements for the `exact` scheme. */
export declare const PaymentRequirementsSchema: z.ZodMiniObject<{
    amount: z.ZodMiniString<string>;
    asset: z.ZodMiniString<string>;
    extra: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
    maxTimeoutSeconds: z.ZodMiniNumber<number>;
    network: z.ZodMiniType<`eip155:${number}`, unknown, z.core.$ZodTypeInternals<`eip155:${number}`, unknown>>;
    payTo: z.ZodMiniString<string>;
    scheme: z.ZodMiniEnum<{
        exact: "exact";
    }>;
}, z.core.$strip>;
/** x402 v2 payment requirements for the `exact` scheme. */
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;
/** x402 v2 protocol extension value. */
export declare const ExtensionSchema: z.ZodMiniObject<{
    info: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
    schema: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
}, z.core.$strip>;
/** x402 v2 protocol extension value. */
export type Extension = z.infer<typeof ExtensionSchema>;
/** x402 v2 protocol extensions map. */
export declare const ExtensionsSchema: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniObject<{
    info: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
    schema: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
}, z.core.$strip>>;
/** x402 v2 protocol extensions map. */
export type Extensions = z.infer<typeof ExtensionsSchema>;
/** Public exact EVM route request accepted by `mppx` handlers. */
export type ExactRequest = PaymentRequirements & {
    extensions?: Extensions | undefined;
    resource?: ResourceInfo | undefined;
};
/** x402 v2 payment-required response. */
export declare const PaymentRequiredSchema: z.ZodMiniObject<{
    accepts: z.ZodMiniArray<z.ZodMiniObject<{
        amount: z.ZodMiniString<string>;
        asset: z.ZodMiniString<string>;
        extra: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
        maxTimeoutSeconds: z.ZodMiniNumber<number>;
        network: z.ZodMiniType<`eip155:${number}`, unknown, z.core.$ZodTypeInternals<`eip155:${number}`, unknown>>;
        payTo: z.ZodMiniString<string>;
        scheme: z.ZodMiniEnum<{
            exact: "exact";
        }>;
    }, z.core.$strip>>;
    error: z.ZodMiniOptional<z.ZodMiniString<string>>;
    extensions: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniObject<{
        info: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
        schema: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
    }, z.core.$strip>>>;
    resource: z.ZodMiniObject<{
        description: z.ZodMiniOptional<z.ZodMiniString<string>>;
        iconUrl: z.ZodMiniOptional<z.ZodMiniString<string>>;
        mimeType: z.ZodMiniOptional<z.ZodMiniString<string>>;
        serviceName: z.ZodMiniOptional<z.ZodMiniString<string>>;
        tags: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniString<string>>>;
        url: z.ZodMiniString<string>;
    }, z.core.$strip>;
    x402Version: z.ZodMiniLiteral<2>;
}, z.core.$strip>;
/** x402 v2 payment-required response. */
export type PaymentRequired = z.infer<typeof PaymentRequiredSchema>;
/** EIP-3009 transferWithAuthorization payload for exact EVM payments. */
export declare const ExactEip3009PayloadSchema: z.ZodMiniObject<{
    authorization: z.ZodMiniObject<{
        from: z.ZodMiniString<string>;
        nonce: z.ZodMiniString<string>;
        to: z.ZodMiniString<string>;
        validAfter: z.ZodMiniString<string>;
        validBefore: z.ZodMiniString<string>;
        value: z.ZodMiniString<string>;
    }, z.core.$strip>;
    signature: z.ZodMiniString<string>;
}, z.core.$strip>;
/** EIP-3009 transferWithAuthorization payload for exact EVM payments. */
export type ExactEip3009Payload = z.infer<typeof ExactEip3009PayloadSchema>;
/** Permit2 payload for exact EVM payments. */
export declare const ExactPermit2PayloadSchema: z.ZodMiniObject<{
    permit2Authorization: z.ZodMiniObject<{
        deadline: z.ZodMiniString<string>;
        from: z.ZodMiniString<string>;
        nonce: z.ZodMiniString<string>;
        permitted: z.ZodMiniObject<{
            amount: z.ZodMiniString<string>;
            token: z.ZodMiniString<string>;
        }, z.core.$strip>;
        spender: z.ZodMiniString<string>;
        witness: z.ZodMiniObject<{
            to: z.ZodMiniString<string>;
            validAfter: z.ZodMiniString<string>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    signature: z.ZodMiniString<string>;
}, z.core.$strip>;
/** Permit2 payload for exact EVM payments. */
export type ExactPermit2Payload = z.infer<typeof ExactPermit2PayloadSchema>;
/** Exact EVM payment payload body. */
export declare const ExactPayloadSchema: z.ZodMiniUnion<readonly [z.ZodMiniObject<{
    authorization: z.ZodMiniObject<{
        from: z.ZodMiniString<string>;
        nonce: z.ZodMiniString<string>;
        to: z.ZodMiniString<string>;
        validAfter: z.ZodMiniString<string>;
        validBefore: z.ZodMiniString<string>;
        value: z.ZodMiniString<string>;
    }, z.core.$strip>;
    signature: z.ZodMiniString<string>;
}, z.core.$strip>, z.ZodMiniObject<{
    permit2Authorization: z.ZodMiniObject<{
        deadline: z.ZodMiniString<string>;
        from: z.ZodMiniString<string>;
        nonce: z.ZodMiniString<string>;
        permitted: z.ZodMiniObject<{
            amount: z.ZodMiniString<string>;
            token: z.ZodMiniString<string>;
        }, z.core.$strip>;
        spender: z.ZodMiniString<string>;
        witness: z.ZodMiniObject<{
            to: z.ZodMiniString<string>;
            validAfter: z.ZodMiniString<string>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    signature: z.ZodMiniString<string>;
}, z.core.$strip>]>;
/** Exact EVM payment payload body. */
export type ExactPayload = z.infer<typeof ExactPayloadSchema>;
/** x402 v2 payment payload. */
export declare const PaymentPayloadSchema: z.ZodMiniObject<{
    accepted: z.ZodMiniObject<{
        amount: z.ZodMiniString<string>;
        asset: z.ZodMiniString<string>;
        extra: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
        maxTimeoutSeconds: z.ZodMiniNumber<number>;
        network: z.ZodMiniType<`eip155:${number}`, unknown, z.core.$ZodTypeInternals<`eip155:${number}`, unknown>>;
        payTo: z.ZodMiniString<string>;
        scheme: z.ZodMiniEnum<{
            exact: "exact";
        }>;
    }, z.core.$strip>;
    extensions: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniObject<{
        info: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
        schema: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
    }, z.core.$strip>>>;
    payload: z.ZodMiniUnion<readonly [z.ZodMiniObject<{
        authorization: z.ZodMiniObject<{
            from: z.ZodMiniString<string>;
            nonce: z.ZodMiniString<string>;
            to: z.ZodMiniString<string>;
            validAfter: z.ZodMiniString<string>;
            validBefore: z.ZodMiniString<string>;
            value: z.ZodMiniString<string>;
        }, z.core.$strip>;
        signature: z.ZodMiniString<string>;
    }, z.core.$strip>, z.ZodMiniObject<{
        permit2Authorization: z.ZodMiniObject<{
            deadline: z.ZodMiniString<string>;
            from: z.ZodMiniString<string>;
            nonce: z.ZodMiniString<string>;
            permitted: z.ZodMiniObject<{
                amount: z.ZodMiniString<string>;
                token: z.ZodMiniString<string>;
            }, z.core.$strip>;
            spender: z.ZodMiniString<string>;
            witness: z.ZodMiniObject<{
                to: z.ZodMiniString<string>;
                validAfter: z.ZodMiniString<string>;
            }, z.core.$strip>;
        }, z.core.$strip>;
        signature: z.ZodMiniString<string>;
    }, z.core.$strip>]>;
    resource: z.ZodMiniOptional<z.ZodMiniObject<{
        description: z.ZodMiniOptional<z.ZodMiniString<string>>;
        iconUrl: z.ZodMiniOptional<z.ZodMiniString<string>>;
        mimeType: z.ZodMiniOptional<z.ZodMiniString<string>>;
        serviceName: z.ZodMiniOptional<z.ZodMiniString<string>>;
        tags: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniString<string>>>;
        url: z.ZodMiniString<string>;
    }, z.core.$strip>>;
    x402Version: z.ZodMiniLiteral<2>;
}, z.core.$strip>;
/** x402 v2 payment payload. */
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;
/** Facilitator verification response. */
export declare const VerifyResponseSchema: z.ZodMiniObject<{
    extensions: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniObject<{
        info: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
        schema: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
    }, z.core.$strip>>>;
    extra: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
    invalidMessage: z.ZodMiniOptional<z.ZodMiniString<string>>;
    invalidReason: z.ZodMiniOptional<z.ZodMiniString<string>>;
    isValid: z.ZodMiniBoolean<boolean>;
    payer: z.ZodMiniOptional<z.ZodMiniString<string>>;
}, z.core.$strip>;
/** Facilitator verification response. */
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;
/** Facilitator settlement response and x402 `PAYMENT-RESPONSE` body. */
export declare const SettleResponseSchema: z.ZodMiniObject<{
    amount: z.ZodMiniOptional<z.ZodMiniString<string>>;
    errorMessage: z.ZodMiniOptional<z.ZodMiniString<string>>;
    errorReason: z.ZodMiniOptional<z.ZodMiniString<string>>;
    extensions: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniObject<{
        info: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
        schema: z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>;
    }, z.core.$strip>>>;
    extra: z.ZodMiniOptional<z.ZodMiniRecord<z.ZodMiniString<string>, z.ZodMiniUnknown>>;
    network: z.ZodMiniString<string>;
    payer: z.ZodMiniOptional<z.ZodMiniString<string>>;
    success: z.ZodMiniBoolean<boolean>;
    transaction: z.ZodMiniString<string>;
}, z.core.$strip>;
/** Facilitator settlement response and x402 `PAYMENT-RESPONSE` body. */
export type SettleResponse = z.infer<typeof SettleResponseSchema>;
/** x402 facilitator client interface used by server exact config. */
export type Facilitator = {
    settle: (paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) => Promise<SettleResponse>;
    verify: (paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) => Promise<VerifyResponse>;
};
/** Extracts x402 `PaymentRequirements` from a canonical exact request. */
export declare function toPaymentRequirements(request: ExactRequest): PaymentRequirements;
//# sourceMappingURL=Types.d.ts.map