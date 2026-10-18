import type { Account } from 'viem';
import * as z from '../zod.js';
import type { SessionSnapshot } from './session/client/Runtime.js';
import type * as PrecompileChannel from './session/precompile/Channel.js';
export declare const chargeModes: readonly ['push', 'pull'];
export type ChargeMode = (typeof chargeModes)[number];
export type SubscriptionPeriodCountInput = string | number | bigint;
declare const subscriptionAccessKey: z.ZodMiniObject<{
    accessKeyAddress: z.ZodMiniPipe<z.ZodMiniString<string>, z.ZodMiniTransform<`0x${string}`, string>>;
    keyType: z.ZodMiniEnum<{
        p256: "p256";
        secp256k1: "secp256k1";
        webAuthn: "webAuthn";
    }>;
}, z.core.$strip>;
/**
 * Tempo charge intent for one-time TIP-20 token transfers.
 *
 * @see https://github.com/tempoxyz/payment-auth-spec/blob/main/specs/methods/tempo/draft-tempo-charge-00.md
 */
export declare const charge: {
    readonly name: "tempo";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: z.ZodMiniDiscriminatedUnion<[z.ZodMiniObject<{
                hash: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"hash">;
            }, z.core.$strip>, z.ZodMiniObject<{
                signature: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"transaction">;
            }, z.core.$strip>, z.ZodMiniObject<{
                signature: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"proof">;
            }, z.core.$strip>], "type">;
        };
        request: z.ZodMiniPipe<z.ZodMiniObject<{
            machineTokenEnabled: z.ZodMiniOptional<z.ZodMiniBoolean<boolean>>;
            amount: z.ZodMiniString<string>;
            chainId: z.ZodMiniOptional<z.ZodMiniNumber<number>>;
            currency: z.ZodMiniString<string>;
            decimals: z.ZodMiniNumber<number>;
            description: z.ZodMiniOptional<z.ZodMiniString<string>>;
            externalId: z.ZodMiniOptional<z.ZodMiniString<string>>;
            feePayer: z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniCustom<Account, Account>]>, z.ZodMiniTransform<boolean, boolean | Account>>>;
            memo: z.ZodMiniOptional<z.ZodMiniNever>;
            recipient: z.ZodMiniOptional<z.ZodMiniString<string>>;
            splits: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniObject<{
                amount: z.ZodMiniString<string>;
                memo: z.ZodMiniOptional<z.ZodMiniString<string>>;
                recipient: z.ZodMiniPipe<z.ZodMiniString<string>, z.ZodMiniTransform<`0x${string}`, string>>;
            }, z.core.$strip>>>;
            supportedModes: z.ZodMiniOptional<z.ZodMiniArray<z.ZodMiniEnum<{
                pull: "pull";
                push: "push";
            }>>>;
        }, z.core.$strip>, z.ZodMiniTransform<{
            currency: string;
            description?: string | undefined;
            externalId?: string | undefined;
            recipient?: string | undefined;
            amount: string;
            methodDetails?: {
                machineTokenEnabled?: boolean | undefined;
                chainId?: number | undefined;
                feePayer?: boolean | undefined;
                splits?: {
                    memo?: string | undefined;
                    recipient: `0x${string}`;
                    amount: string;
                }[] | undefined;
                supportedModes?: ("pull" | "push")[] | undefined;
            } | undefined;
        }, {
            machineTokenEnabled?: boolean | undefined;
            amount: string;
            chainId?: number | undefined;
            currency: string;
            decimals: number;
            description?: string | undefined;
            externalId?: string | undefined;
            feePayer?: boolean | undefined;
            memo?: undefined;
            recipient?: string | undefined;
            splits?: {
                amount: string;
                memo?: string | undefined;
                recipient: `0x${string}`;
            }[] | undefined;
            supportedModes?: ("pull" | "push")[] | undefined;
        }>>;
    };
};
/**
 * Tempo session intent for pay-as-you-go streaming payments.
 *
 * Uses cumulative vouchers over a payment channel. Credential payloads
 * are a discriminated union on `action`: open, topUp, voucher, close.
 */
export declare const session: {
    readonly name: "tempo";
    readonly intent: "session";
    readonly schema: {
        credential: {
            payload: z.ZodMiniDiscriminatedUnion<[z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"open">;
                authorizedSigner: z.ZodMiniOptional<z.ZodMiniString<string>>;
                channelId: z.ZodMiniString<string>;
                cumulativeAmount: z.ZodMiniString<string>;
                descriptor: z.ZodMiniOptional<z.ZodMiniCustom<PrecompileChannel.ChannelDescriptor, PrecompileChannel.ChannelDescriptor>>;
                signature: z.ZodMiniString<string>;
                transaction: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"transaction">;
            }, z.core.$strip>, z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"topUp">;
                additionalDeposit: z.ZodMiniString<string>;
                channelId: z.ZodMiniString<string>;
                descriptor: z.ZodMiniOptional<z.ZodMiniCustom<PrecompileChannel.ChannelDescriptor, PrecompileChannel.ChannelDescriptor>>;
                transaction: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"transaction">;
            }, z.core.$strip>, z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"voucher">;
                channelId: z.ZodMiniString<string>;
                cumulativeAmount: z.ZodMiniString<string>;
                descriptor: z.ZodMiniOptional<z.ZodMiniCustom<PrecompileChannel.ChannelDescriptor, PrecompileChannel.ChannelDescriptor>>;
                signature: z.ZodMiniString<string>;
            }, z.core.$strip>, z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"close">;
                channelId: z.ZodMiniString<string>;
                cumulativeAmount: z.ZodMiniString<string>;
                descriptor: z.ZodMiniOptional<z.ZodMiniCustom<PrecompileChannel.ChannelDescriptor, PrecompileChannel.ChannelDescriptor>>;
                signature: z.ZodMiniString<string>;
            }, z.core.$strip>], "action">;
        };
        request: z.ZodMiniPipe<z.ZodMiniObject<{
            amount: z.ZodMiniString<string>;
            chainId: z.ZodMiniOptional<z.ZodMiniNumber<number>>;
            channelId: z.ZodMiniOptional<z.ZodMiniString<string>>;
            currency: z.ZodMiniString<string>;
            decimals: z.ZodMiniNumber<number>;
            escrowContract: z.ZodMiniOptional<z.ZodMiniString<string>>;
            feePayer: z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniCustom<Account, Account>]>, z.ZodMiniTransform<boolean, boolean | Account>>>;
            feeToken: z.ZodMiniOptional<z.ZodMiniString<string>>;
            minVoucherDelta: z.ZodMiniOptional<z.ZodMiniString<string>>;
            operator: z.ZodMiniOptional<z.ZodMiniString<string>>;
            recipient: z.ZodMiniOptional<z.ZodMiniString<string>>;
            sessionProtocol: z.ZodMiniOptional<z.ZodMiniEnum<{
                v1: "v1";
                v2: "v2";
            }>>;
            sessionSnapshot: z.ZodMiniOptional<z.ZodMiniCustom<SessionSnapshot, SessionSnapshot>>;
            suggestedDeposit: z.ZodMiniOptional<z.ZodMiniString<string>>;
            unitType: z.ZodMiniString<string>;
        }, z.core.$strip>, z.ZodMiniTransform<{
            currency: string;
            recipient?: string | undefined;
            unitType: string;
            amount: string;
            suggestedDeposit?: string | undefined;
            methodDetails: {
                escrowContract: string | undefined;
                channelId?: string | undefined;
                minVoucherDelta?: string | undefined;
                chainId?: number | undefined;
                feePayer?: boolean | undefined;
                feeToken?: string | undefined;
                operator?: string | undefined;
                sessionProtocol?: "v1" | "v2" | undefined;
                sessionSnapshot?: SessionSnapshot | undefined;
            };
        }, {
            amount: string;
            chainId?: number | undefined;
            channelId?: string | undefined;
            currency: string;
            decimals: number;
            escrowContract?: string | undefined;
            feePayer?: boolean | undefined;
            feeToken?: string | undefined;
            minVoucherDelta?: string | undefined;
            operator?: string | undefined;
            recipient?: string | undefined;
            sessionProtocol?: "v1" | "v2" | undefined;
            sessionSnapshot?: SessionSnapshot | undefined;
            suggestedDeposit?: string | undefined;
            unitType: string;
        }>>;
    };
};
/**
 * Tempo subscription intent for recurring TIP-20 token transfers.
 *
 * Uses a signed key authorization that delegates one transfer per billing period.
 */
export declare const subscription: {
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
                accessKey?: z.infer<typeof subscriptionAccessKey> | undefined;
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
};
export {};
//# sourceMappingURL=Methods.d.ts.map