import type { MaybePromise } from '../../internal/types.js';
import * as Method from '../../Method.js';
import * as Account from '../../viem/Account.js';
import * as Client from '../../viem/Client.js';
import * as z from '../../zod.js';
import * as Methods from '../Methods.js';
import type { SubscriptionAccessKey } from '../subscription/Types.js';
/** Context accepted by the Tempo subscription client method. */
export declare const subscriptionContextSchema: z.ZodMiniObject<{
    accessKey: z.ZodMiniOptional<z.ZodMiniCustom<SubscriptionAccessKey, SubscriptionAccessKey>>;
    account: z.ZodMiniOptional<z.ZodMiniCustom<`0x${string}` | Account.Account | undefined, `0x${string}` | Account.Account | undefined>>;
}, z.core.$strip>;
/** Runtime context for creating a Tempo subscription credential. */
export type SubscriptionContext = z.infer<typeof subscriptionContextSchema>;
/** Creates a Tempo subscription client method. */
export declare function subscription(parameters?: subscription.Parameters): Method.Client<{
    readonly name: "tempo";
    readonly intent: "subscription";
    readonly schema: {
        credential: {
            payload: z.ZodMiniObject<{
                signature: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"keyAuthorization">;
            }, z.core.$strip>;
        };
        request: z.ZodMiniPipe<z.ZodMiniObject<{
            amount: z.ZodMiniString<string>;
            accessKey: z.ZodMiniOptional<z.ZodMiniObject<{
                accessKeyAddress: z.ZodMiniPipe<z.ZodMiniString<string>, z.ZodMiniTransform<`0x${string}`, string>>;
                keyType: z.ZodMiniEnum<{
                    p256: "p256";
                    secp256k1: "secp256k1";
                    webAuthn: "webAuthn";
                }>;
            }, z.core.$strip>>;
            chainId: z.ZodMiniOptional<z.ZodMiniNumber<number>>;
            currency: z.ZodMiniPipe<z.ZodMiniString<string>, z.ZodMiniTransform<`0x${string}`, string>>;
            decimals: z.ZodMiniNumber<number>;
            description: z.ZodMiniOptional<z.ZodMiniString<string>>;
            externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
            methodDetails: z.ZodMiniOptional<z.ZodMiniObject<{
                accessKey: z.ZodMiniOptional<z.ZodMiniObject<{
                    accessKeyAddress: z.ZodMiniPipe<z.ZodMiniString<string>, z.ZodMiniTransform<`0x${string}`, string>>;
                    keyType: z.ZodMiniEnum<{
                        p256: "p256";
                        secp256k1: "secp256k1";
                        webAuthn: "webAuthn";
                    }>;
                }, z.core.$strip>>;
                chainId: z.ZodMiniOptional<z.ZodMiniNumber<number>>;
            }, z.core.$strip>>;
            periodCount: z.ZodMiniPipe<z.ZodMiniUnion<readonly [z.ZodMiniString<string>, z.ZodMiniBigInt<bigint>, z.ZodMiniCustom<number, number>]>, z.ZodMiniTransform<string, string | number | bigint>>;
            periodUnit: z.ZodMiniEnum<{
                day: "day";
                dev_second: "dev_second";
                week: "week";
            }>;
            recipient: z.ZodMiniPipe<z.ZodMiniString<string>, z.ZodMiniTransform<`0x${string}`, string>>;
            subscriptionExpires: z.ZodMiniPipe<z.ZodMiniUnion<readonly [z.ZodMiniString<string>, z.ZodMiniCustom<Date, Date>]>, z.ZodMiniTransform<Date, z.DatetimeInput>>;
        }, z.core.$strip>, z.ZodMiniTransform<{
            currency: `0x${string}`;
            description?: string | undefined;
            externalId?: string | undefined;
            periodCount: string;
            periodUnit: "day" | "dev_second" | "week";
            recipient: `0x${string}`;
            amount: string;
            subscriptionExpires: string;
            methodDetails?: {
                accessKey?: z.infer<z.ZodMiniObject<{
                    accessKeyAddress: z.ZodMiniPipe<z.ZodMiniString<string>, z.ZodMiniTransform<`0x${string}`, string>>;
                    keyType: z.ZodMiniEnum<{
                        p256: "p256";
                        secp256k1: "secp256k1";
                        webAuthn: "webAuthn";
                    }>;
                }, z.core.$strip>> | undefined;
                chainId?: number | undefined;
            } | undefined;
        }, {
            amount: string;
            accessKey?: {
                accessKeyAddress: `0x${string}`;
                keyType: "p256" | "secp256k1" | "webAuthn";
            } | undefined;
            chainId?: number | undefined;
            currency: `0x${string}`;
            decimals: number;
            description?: string | undefined;
            externalId?: string | undefined;
            methodDetails?: {
                accessKey?: {
                    accessKeyAddress: `0x${string}`;
                    keyType: "p256" | "secp256k1" | "webAuthn";
                } | undefined;
                chainId?: number | undefined;
            } | undefined;
            periodCount: string;
            periodUnit: "day" | "dev_second" | "week";
            recipient: `0x${string}`;
            subscriptionExpires: Date;
        }>>;
    };
}, z.ZodMiniObject<{
    accessKey: z.ZodMiniOptional<z.ZodMiniCustom<SubscriptionAccessKey, SubscriptionAccessKey>>;
    account: z.ZodMiniOptional<z.ZodMiniCustom<`0x${string}` | Account.Account | undefined, `0x${string}` | Account.Account | undefined>>;
}, z.core.$strip>>;
export declare namespace subscription {
    /** Parameters for creating a Tempo subscription credential. */
    type Parameters = Account.getResolver.Parameters & Client.getResolver.Parameters & {
        accessKey?: SubscriptionAccessKey | undefined;
        validateRequest?: ((request: ReturnType<typeof Methods.subscription.schema.request.parse>) => MaybePromise<void>) | undefined;
    };
}
//# sourceMappingURL=Subscription.d.ts.map