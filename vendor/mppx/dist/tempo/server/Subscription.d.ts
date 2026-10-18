import { type Address } from 'viem';
import type { LooseOmit, MaybePromise, NoExtraKeys } from '../../internal/types.js';
import * as Method from '../../Method.js';
import * as Store from '../../Store.js';
import type * as Client from '../../viem/Client.js';
import * as Account from '../internal/account.js';
import * as FeePayer from '../internal/fee-payer.js';
import type * as types from '../internal/types.js';
import * as Methods from '../Methods.js';
import type { SubscriptionAccessKey, SubscriptionCredentialPayload, SubscriptionLookup, SubscriptionPeriodUnit, SubscriptionRecord, SubscriptionReceipt as SubscriptionReceiptValue } from '../subscription/Types.js';
type SubscriptionRequest = ReturnType<typeof Methods.subscription.schema.request.parse>;
/**
 * Creates a Tempo subscription method for recurring TIP-20 token payments.
 *
 * The method handles activation, request-path reuse, and optional lazy renewals.
 */
export declare function subscription<const parameters extends subscription.Parameters>(p: NoExtraKeys<parameters, subscription.Parameters>): Method.Server<{
    readonly name: "tempo";
    readonly intent: "subscription";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"keyAuthorization">;
            }, import("zod/v4/core").$strip>;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            accessKey: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniObject<{
                accessKeyAddress: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniTransform<`0x${string}`, string>>;
                keyType: import("zod/mini").ZodMiniEnum<{
                    p256: "p256";
                    secp256k1: "secp256k1";
                    webAuthn: "webAuthn";
                }>;
            }, import("zod/v4/core").$strip>>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            currency: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniTransform<`0x${string}`, string>>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            methodDetails: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniObject<{
                accessKey: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniObject<{
                    accessKeyAddress: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniTransform<`0x${string}`, string>>;
                    keyType: import("zod/mini").ZodMiniEnum<{
                        p256: "p256";
                        secp256k1: "secp256k1";
                        webAuthn: "webAuthn";
                    }>;
                }, import("zod/v4/core").$strip>>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            }, import("zod/v4/core").$strip>>;
            periodCount: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniBigInt<bigint>, import("zod/mini").ZodMiniCustom<number, number>]>, import("zod/mini").ZodMiniTransform<string, string | number | bigint>>;
            periodUnit: import("zod/mini").ZodMiniEnum<{
                day: "day";
                dev_second: "dev_second";
                week: "week";
            }>;
            recipient: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniTransform<`0x${string}`, string>>;
            subscriptionExpires: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniCustom<Date, Date>]>, import("zod/mini").ZodMiniTransform<Date, import("../../zod.js").DatetimeInput>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
            currency: `0x${string}`;
            description?: string | undefined;
            externalId?: string | undefined;
            periodCount: string;
            periodUnit: "day" | "dev_second" | "week";
            recipient: `0x${string}`;
            amount: string;
            subscriptionExpires: string;
            methodDetails?: {
                accessKey?: import("zod").output<import("zod/mini").ZodMiniObject<{
                    accessKeyAddress: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniTransform<`0x${string}`, string>>;
                    keyType: import("zod/mini").ZodMiniEnum<{
                        p256: "p256";
                        secp256k1: "secp256k1";
                        webAuthn: "webAuthn";
                    }>;
                }, import("zod/v4/core").$strip>> | undefined;
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
}, subscription.DeriveDefaults<parameters>, undefined, subscription.Extensions, undefined>;
/**
 * Renews an overdue subscription outside of the HTTP request path.
 * Intended for cron jobs or background workers that bill subscriptions on a schedule.
 *
 * Returns the renewal result if the subscription was overdue, or `null` if already current.
 */
export declare function renew(parameters: renew.Parameters): Promise<renew.Result | null>;
export declare namespace renew {
    /** Parameters for renewing an overdue subscription outside the request path. */
    type Parameters = Account.resolve.Parameters & Client.getResolver.Parameters & {
        /** The subscription to renew. */
        subscriptionId: string;
        /** Billing callback -- same signature as the `renew` hook on {@link subscription}. */
        renew?: subscription.Parameters['renew'];
        /** Store containing subscription records. */
        store: Store.AtomicStore<Record<string, unknown>>;
        /**
         * Milliseconds before an in-flight renewal lock can be replaced.
         * Keeps concurrent renewal safe while allowing recovery from abandoned attempts.
         */
        renewalTimeoutMs?: number | undefined;
        /**
         * Override the fee-payer policy for sponsored subscription payments.
         * Useful when the access key renewal tx requires more gas than the default policy allows.
         */
        feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
        waitForConfirmation?: boolean | undefined;
    };
    /** Renewal result returned by {@link renew}. */
    type Result = subscription.RenewalResult;
}
export declare namespace subscription {
    /** Request-scoped lookup key used to find the active subscription. */
    type ResolvedSubscription = SubscriptionLookup;
    /** Activation result returned after the initial credential is verified. */
    type ActivationResult = {
        receipt: SubscriptionReceiptValue;
        subscription: SubscriptionRecord;
    };
    /** Renewal result returned when an overdue subscription is charged. */
    type RenewalResult = {
        receipt: SubscriptionReceiptValue;
        subscription: SubscriptionRecord;
    };
    /** Parameters for renewing through a configured `mppx.tempo.subscription` handler. */
    type RenewParameters = {
        /** The subscription to renew. */
        subscriptionId: string;
        /**
         * Override the fee-payer policy for sponsored subscription payments.
         * Useful when the access key renewal tx requires more gas than the default policy allows.
         */
        feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
        waitForConfirmation?: boolean | undefined;
    };
    /** Handler extensions attached to `mppx.tempo.subscription`. */
    type Extensions = {
        renew: (parameters: RenewParameters) => Promise<renew.Result | null>;
    };
    /** Request defaults supported by the subscription method. */
    type Defaults = LooseOmit<Method.RequestDefaults<typeof Methods.subscription>, 'accessKey' | 'recipient'>;
    /** Parameters for configuring a Tempo subscription method. */
    type Parameters = Account.resolve.Parameters & Client.getResolver.Parameters & {
        accessKey?: ((parameters: {
            input: Request;
            request: SubscriptionRequest;
            resolved: ResolvedSubscription;
        }) => MaybePromise<SubscriptionAccessKey>) | undefined;
        /**
         * Milliseconds before an in-flight activation lock can be replaced.
         * Keeps concurrent activation safe while allowing recovery from abandoned attempts.
         */
        activationTimeoutMs?: number | undefined;
        /**
         * Milliseconds before an in-flight renewal lock can be replaced.
         * Keeps concurrent renewal safe while allowing recovery from abandoned attempts.
         */
        renewalTimeoutMs?: number | undefined;
        /**
         * Requires a fresh subscription Credential even when a subscription is active.
         * This binds access reuse to the stored payer instead of trusting request metadata alone.
         */
        requireCredential?: boolean | undefined;
        /**
         * Override the fee-payer policy for sponsored subscription payments.
         * Useful when the access key + key authorization tx requires more gas
         * than the default policy allows.
         */
        feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
        activate?: ((parameters: {
            /** Custom activation must verify this access key matches the resolved subscription. */
            accessKey: SubscriptionAccessKey;
            credential: {
                payload: SubscriptionCredentialPayload;
                source?: string | undefined;
            };
            input: Request;
            request: SubscriptionRequest;
            resolved: ResolvedSubscription;
            source: {
                address: Address;
                chainId: number;
            } | null;
        }) => Promise<ActivationResult>) | undefined;
        hooks?: {
            activated?: ((parameters: {
                receipt: SubscriptionReceiptValue;
                subscription: SubscriptionRecord;
            }) => MaybePromise<void>) | undefined;
            renewed?: ((parameters: {
                periodIndex: number;
                receipt: SubscriptionReceiptValue;
                subscription: SubscriptionRecord;
            }) => MaybePromise<void>) | undefined;
        } | undefined;
        periodCount?: Methods.SubscriptionPeriodCountInput | undefined;
        periodUnit?: SubscriptionPeriodUnit | undefined;
        /**
         * Resolves the request identity. This callback must authenticate and
         * authorize the caller before returning a key; automatic mode may create
         * a server-owned access key for that key while issuing a challenge.
         */
        resolve: (parameters: {
            input: Request;
            request: SubscriptionRequest;
            /** Verified payer identity recovered from a signed subscription credential. */
            source?: {
                address: Address;
                chainId: number;
            } | undefined;
        }) => MaybePromise<ResolvedSubscription | null>;
        renew?: (parameters: {
            /** Stable idempotency/reconciliation reference persisted before the renewal hook runs. */
            inFlightReference: string;
            periodIndex: number;
            /** Custom renewal hooks must preserve amount, currency, recipient, period, expiry, and lookup key. */
            subscription: SubscriptionRecord;
        }) => Promise<RenewalResult>;
        store?: Store.AtomicStore<Record<string, unknown>> | undefined;
        /**
         * Prefix prepended to all subscription store keys.
         *
         * By default, no prefix is applied.
         */
        storeKeyPrefix?: string | undefined;
        testnet?: boolean | undefined;
        waitForConfirmation?: boolean | undefined;
    } & Defaults & Method.ComposableHooks<typeof Methods.subscription>;
    /** Derived defaults after account and chain configuration are applied. */
    type DeriveDefaults<parameters extends Parameters> = types.DeriveDefaults<parameters, Defaults, {
        currency: string;
        decimals: number;
    }>;
}
export {};
//# sourceMappingURL=Subscription.d.ts.map