import * as z from '../zod.js';
/** Payment method name for Payment-auth EVM challenges. */
export declare const paymentMethod: 'evm';
/** Payment intent name for one-time EVM charges. */
export declare const chargeIntent: 'charge';
/** CAIP-2 namespace prefix for EVM networks. */
export declare const evmNetworkPrefix: 'eip155:';
/** EIP-3009 transfer authorization method identifier. */
export declare const eip3009: 'eip3009';
/** EVM charge credential types supported by this package. */
export declare const credentialTypes: readonly ['authorization'];
/** EIP-3009 domain metadata for `transferWithAuthorization` signatures. */
export declare const AuthorizationConfigSchema: z.ZodMiniObject<{
    name: z.ZodMiniString<string>;
    version: z.ZodMiniString<string>;
}, z.core.$strip>;
export type AuthorizationConfig = z.infer<typeof AuthorizationConfigSchema>;
/** CAIP-2 EVM network identifier. */
export type EvmNetwork = `${typeof evmNetworkPrefix}${number}`;
/** EVM-specific charge method details. */
export declare const MethodDetailsSchema: z.ZodMiniObject<{
    chainId: z.ZodMiniNumber<number>;
    credentialTypes: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniEnum<{
        authorization: "authorization";
    }>>>;
    decimals: z.ZodMiniOptional<z.ZodMiniNumber<number>>;
    permit2Address: z.ZodMiniOptional<z.ZodMiniString<string>>;
    splits: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
        amount: z.ZodMiniString<string>;
        recipient: z.ZodMiniString<string>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type MethodDetails = z.infer<typeof MethodDetailsSchema>;
/** Canonical Payment-auth EVM charge request. */
export declare const ChargeRequestSchema: z.ZodMiniObject<{
    amount: z.ZodMiniString<string>;
    currency: z.ZodMiniString<string>;
    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
    externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
    methodDetails: z.ZodMiniObject<{
        chainId: z.ZodMiniNumber<number>;
        credentialTypes: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniEnum<{
            authorization: "authorization";
        }>>>;
        decimals: z.ZodMiniOptional<z.ZodMiniNumber<number>>;
        permit2Address: z.ZodMiniOptional<z.ZodMiniString<string>>;
        splits: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
            amount: z.ZodMiniString<string>;
            recipient: z.ZodMiniString<string>;
        }, z.core.$strip>>>;
    }, z.core.$strip>;
    recipient: z.ZodMiniString<string>;
}, z.core.$strip>;
export type ChargeRequest = z.infer<typeof ChargeRequestSchema>;
/** Public route input before display-unit amounts are converted to atomic units. */
export declare const ChargeRequestInputSchema: z.ZodMiniObject<{
    amount: z.ZodMiniString<string>;
    chainId: z.ZodMiniNumber<number>;
    currency: z.ZodMiniString<string>;
    credentialTypes: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniEnum<{
        authorization: "authorization";
    }>>>;
    decimals: z.ZodMiniNumber<number>;
    description: z.ZodMiniOptional<z.ZodMiniString<string>>;
    externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
    permit2Address: z.ZodMiniOptional<z.ZodMiniString<string>>;
    recipient: z.ZodMiniString<string>;
    splits: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
        amount: z.ZodMiniString<string>;
        recipient: z.ZodMiniString<string>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type ChargeRequestInput = z.infer<typeof ChargeRequestInputSchema>;
/** Payment-auth EVM authorization credential payload. */
export declare const AuthorizationPayloadSchema: z.ZodMiniObject<{
    from: z.ZodMiniString<string>;
    nonce: z.ZodMiniString<string>;
    signature: z.ZodMiniString<string>;
    to: z.ZodMiniString<string>;
    type: z.ZodMiniLiteral<"authorization">;
    validAfter: z.ZodMiniString<string>;
    validBefore: z.ZodMiniString<string>;
    value: z.ZodMiniString<string>;
}, z.core.$strip>;
export type AuthorizationPayload = z.infer<typeof AuthorizationPayloadSchema>;
/** Payment-auth EVM charge credential payload. */
export declare const ChargePayloadSchema: z.ZodMiniObject<{
    from: z.ZodMiniString<string>;
    nonce: z.ZodMiniString<string>;
    signature: z.ZodMiniString<string>;
    to: z.ZodMiniString<string>;
    type: z.ZodMiniLiteral<"authorization">;
    validAfter: z.ZodMiniString<string>;
    validBefore: z.ZodMiniString<string>;
    value: z.ZodMiniString<string>;
}, z.core.$strip>;
export type ChargePayload = z.infer<typeof ChargePayloadSchema>;
/** EIP-712 type definition for EIP-3009 `transferWithAuthorization`. */
export declare const authorizationTypes: {
    readonly TransferWithAuthorization: readonly [{
        readonly name: 'from';
        readonly type: 'address';
    }, {
        readonly name: 'to';
        readonly type: 'address';
    }, {
        readonly name: 'value';
        readonly type: 'uint256';
    }, {
        readonly name: 'validAfter';
        readonly type: 'uint256';
    }, {
        readonly name: 'validBefore';
        readonly type: 'uint256';
    }, {
        readonly name: 'nonce';
        readonly type: 'bytes32';
    }];
};
/** Returns the EIP-712 domain for an EIP-3009 authorization signature. */
export declare function authorizationDomain(parameters: {
    authorization: AuthorizationConfig;
    chainId: number;
    currency: `0x${string}`;
}): {
    readonly chainId: number;
    readonly name: string;
    readonly verifyingContract: `0x${string}`;
    readonly version: string;
};
/** Computes the Payment-auth EVM challenge hash used as the EIP-3009 nonce. */
export declare function challengeHash(challenge: {
    id: string;
    realm: string;
}): `0x${string}`;
/** Converts a chain ID to the CAIP-2 EVM network identifier. */
export declare function networkOf(chainId: number): EvmNetwork;
/** Formats an EVM address as a did:pkh source identifier. */
export declare function toSource(parameters: {
    address: `0x${string}`;
    chainId: number;
}): `did:pkh:eip155:${number}:0x${string}`;
//# sourceMappingURL=Types.d.ts.map