import type { Account } from 'viem';
import * as Method from '../../Method.js';
import * as z from '../../zod.js';
import * as Assets from '../Assets.js';
import * as Types from '../Types.js';
/**
 * Creates an EVM charge client method.
 *
 * Signs native Payment-auth `authorization` credentials for EVM charges. It
 * also keeps x402 exact signing for x402 compatibility challenges.
 */
export declare function charge(parameters: charge.Parameters): Method.Client<{
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
}, z.ZodMiniObject<{
    account: z.ZodMiniOptional<z.ZodMiniCustom<Account, Account>>;
}, z.core.$strip>>;
export declare namespace charge {
    type Signer = Account & {
        signTypedData?: (parameters: any) => Promise<`0x${string}`>;
    };
    type Parameters = {
        /** Account used to sign credentials. May instead be supplied to `createCredential` after payment preparation. */
        account?: Account | undefined;
        /** EIP-3009 token domain metadata for custom currencies. */
        authorization?: Types.AuthorizationConfig | undefined;
        /** Optional token decimals used to parse `maxAmount` when currency metadata is not provided. */
        decimals?: number | undefined;
        /** Optional maximum display-unit amount the client is willing to pay. */
        maxAmount?: string | undefined;
        /** Optional maximum atomic amount the client is willing to pay. */
        maxAtomicAmount?: string | undefined;
        /** Optional allowlist of supported EVM chain IDs. */
        networks?: readonly number[] | undefined;
        /** Optional allowlist of supported currencies. */
        currencies?: readonly Assets.Currency[] | undefined;
        /** Legacy alias for `currencies`. */
        assets?: readonly Assets.Currency[] | undefined;
    };
}
//# sourceMappingURL=Charge.d.ts.map