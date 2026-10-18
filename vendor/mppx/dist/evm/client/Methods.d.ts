import * as Assets from '../Assets.js';
import * as Chains from '../Chains.js';
import { charge as charge_ } from './Charge.js';
/** Creates EVM client methods from shared charge parameters. */
export declare function evm(parameters: evm.Parameters): readonly [import("../../Method.js").Client<{
    readonly name: "evm";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniObject<{
                from: import("zod/mini").ZodMiniString<string>;
                nonce: import("zod/mini").ZodMiniString<string>;
                signature: import("zod/mini").ZodMiniString<string>;
                to: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"authorization">;
                validAfter: import("zod/mini").ZodMiniString<string>;
                validBefore: import("zod/mini").ZodMiniString<string>;
                value: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniNumber<number>;
            currency: import("zod/mini").ZodMiniString<string>;
            credentialTypes: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniEnum<{
                authorization: "authorization";
            }>>>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            permit2Address: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            recipient: import("zod/mini").ZodMiniString<string>;
            splits: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                recipient: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
}, import("zod/mini").ZodMiniObject<{
    account: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>>;
}, import("zod/v4/core").$strip>>];
export declare namespace evm {
    type Parameters = charge_.Parameters;
    /** Creates an EVM `charge` client method. */
    const charge: typeof charge_;
    /** Known EVM asset metadata for public config. */
    const assets: typeof Assets;
    /** Common EVM chain IDs for public config. */
    const chains: typeof Chains;
}
//# sourceMappingURL=Methods.d.ts.map