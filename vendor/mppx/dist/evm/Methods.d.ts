import * as z from '../zod.js';
/** Native Payment-auth EVM charge method. */
export declare const charge: {
    readonly name: "evm";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: z.ZodMiniObject<{
                from: z.ZodMiniString<string>;
                nonce: z.ZodMiniString<string>;
                signature: z.ZodMiniString<string>;
                to: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"authorization">;
                validAfter: z.ZodMiniString<string>;
                validBefore: z.ZodMiniString<string>;
                value: z.ZodMiniString<string>;
            }, z.core.$strip>;
        };
        request: z.ZodMiniPipe<z.ZodMiniObject<{
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
        }, z.core.$strip>, z.ZodMiniTransform<{
            description?: string | undefined;
            externalId?: string | undefined;
            amount: string;
            currency: `0x${string}`;
            methodDetails: {
                chainId: number;
                credentialTypes: string[];
                decimals: number;
                permit2Address?: `0x${string}` | undefined;
                splits?: {
                    amount: string;
                    recipient: string;
                }[] | undefined;
            };
            recipient: `0x${string}`;
        }, {
            amount: string;
            chainId: number;
            currency: string;
            credentialTypes?: "authorization"[] | undefined;
            decimals: number;
            description?: string | undefined;
            externalId?: string | undefined;
            permit2Address?: string | undefined;
            recipient: string;
            splits?: {
                amount: string;
                recipient: string;
            }[] | undefined;
        }>>;
    };
};
//# sourceMappingURL=Methods.d.ts.map