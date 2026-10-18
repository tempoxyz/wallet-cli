import type { NoExtraKeys } from '../../internal/types.js';
import * as Store from '../../Store.js';
import * as Currencies from '../internal/currencies.js';
import { charge as sessionCharge_, session as session_, settle as settle_, settleBatch as settleBatch_ } from '../session/server/Session.js';
import type { SessionController as SessionController_ } from '../session/server/Sse.js';
import * as Ws_ from '../session/server/Ws.js';
import { charge as charge_ } from './Charge.js';
import type * as Relay_ from './Relay.js';
import { renew as renewSubscription_, subscription as subscription_ } from './Subscription.js';
/**
 * Creates the common Tempo `charge` and `session` methods from shared parameters.
 *
 * Mainnet accepts OUSD first, then USDC.e. Testnet accepts OUSD first, then pathUSD.
 * Use `currencies`
 * for an ordered list of addresses/token definitions, including a one-element
 * list for a single asset. Each currency creates charge and session offers; list
 * order is presentation order, not a requirement on the client's choice.
 * Chain-indexed definitions (including `tokens.tempo` from `viem/tokens`) are
 * filtered to USD tokens deployed on `chainId`. Duplicates are removed by address.
 * Explicit lists replace the defaults; an empty resolved list throws.
 *
 * The chain defaults to Tempo mainnet (Moderato with `testnet: true`). Set
 * `chainId` explicitly when using a custom client for another network.
 *
 * When configured, `relay` applies to the `charge` method. Session vouchers
 * remain local state transitions and session relay delegation will be added
 * with its action-specific lifecycle support.
 *
 * @example
 * ```ts
 * import { Mppx, tempo } from 'mppx/server'
 *
 * const mppx = Mppx.create({
 *   methods: [tempo.common({ recipient: '0x...' })],
 * })
 * ```
 */
export declare function tempo<const parameters extends tempo.Parameters>(parameters?: NoExtraKeys<parameters, tempo.Parameters>): readonly [import("../../Method.js").Server<{
    readonly name: "tempo";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                hash: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"hash">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"proof">;
            }, import("zod/v4/core").$strip>], "type">;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            machineTokenEnabled: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniBoolean<boolean>>;
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            memo: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNever>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            splits: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                memo: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniTransform<`0x${string}`, string>>;
            }, import("zod/v4/core").$strip>>>;
            supportedModes: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniEnum<{
                pull: "pull";
                push: "push";
            }>>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
}, charge_.DeriveDefaults<NoExtraKeys<parameters, tempo.Parameters>>, undefined, {}, string | undefined>, import("../../Method.js").Server<{
    readonly name: "tempo";
    readonly intent: "session";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"open">;
                authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"topUp">;
                additionalDeposit: import("zod/mini").ZodMiniString<string>;
                channelId: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"voucher">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"close">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>], "action">;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                v1: "v1";
                v2: "v2";
            }>>;
            sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
            suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            unitType: import("zod/mini").ZodMiniString<string>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
            sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
            suggestedDeposit?: string | undefined;
            unitType: string;
        }>>;
    };
}, session_.DeriveDefaults<NoExtraKeys<parameters, tempo.Parameters>>, NoExtraKeys<parameters, tempo.Parameters>["sse"] extends false | undefined ? undefined : import("./internal/transport.js").Sse, session_.Extensions, undefined>] | readonly [import("../../Method.js").Server<{
    readonly name: "tempo";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                hash: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"hash">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"proof">;
            }, import("zod/v4/core").$strip>], "type">;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            machineTokenEnabled: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniBoolean<boolean>>;
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            memo: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNever>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            splits: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                memo: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniTransform<`0x${string}`, string>>;
            }, import("zod/v4/core").$strip>>>;
            supportedModes: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniEnum<{
                pull: "pull";
                push: "push";
            }>>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
}, charge_.DeriveDefaults<Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
    currency: string;
    decimals: number;
    chainId: number;
}>, undefined, {}, string | undefined>, {
    alias?: undefined;
    authorize?: import("../../Method.js").AuthorizeFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    defaults?: session_.DeriveDefaults<Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
        currency: string;
        decimals: number;
        chainId: number;
    } & {
        store: Store.AtomicStore<Store.StoreItemMap>;
    }> | undefined;
    html?: import("../../server/internal/html/config.js").Options | undefined;
    preflight?: import("../../Method.js").PreflightFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    request?: import("../../Method.js").RequestFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    respond?: import("../../Method.js").RespondFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    broadcast?: import("../../Method.js").BroadcastFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    stableBinding?: import("../../Method.js").StableBindingFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    transport?: ((Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
        currency: string;
        decimals: number;
        chainId: number;
    } & {
        store: Store.AtomicStore<Store.StoreItemMap>;
    })["sse"] extends false | undefined ? undefined : import("./internal/transport.js").Sse) | undefined;
    validate?: import("../../Method.js").ValidateFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    verify: import("../../Method.js").VerifyFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }>;
    canOffer?: import("../../Method.js").CanOfferFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    onPaymentSuccess?: import("../../Method.js").OnPaymentSuccessFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    name: "tempo";
    intent: "session";
    schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"open">;
                authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"topUp">;
                additionalDeposit: import("zod/mini").ZodMiniString<string>;
                channelId: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"voucher">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"close">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>], "action">;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                v1: "v1";
                v2: "v2";
            }>>;
            sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
            suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            unitType: import("zod/mini").ZodMiniString<string>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
            sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
            suggestedDeposit?: string | undefined;
            unitType: string;
        }>>;
    };
    extensions: session_.Extensions;
}, ...({
    alias?: undefined;
    authorize?: import("../../Method.js").AuthorizeFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    defaults?: session_.DeriveDefaults<Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
        currency: string;
        decimals: number;
        chainId: number;
    } & {
        store: Store.AtomicStore<Store.StoreItemMap>;
    }> | undefined;
    html?: import("../../server/internal/html/config.js").Options | undefined;
    preflight?: import("../../Method.js").PreflightFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    request?: import("../../Method.js").RequestFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    respond?: import("../../Method.js").RespondFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    broadcast?: import("../../Method.js").BroadcastFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    stableBinding?: import("../../Method.js").StableBindingFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    transport?: ((Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
        currency: string;
        decimals: number;
        chainId: number;
    } & {
        store: Store.AtomicStore<Store.StoreItemMap>;
    })["sse"] extends false | undefined ? undefined : import("./internal/transport.js").Sse) | undefined;
    validate?: import("../../Method.js").ValidateFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    verify: import("../../Method.js").VerifyFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }>;
    canOffer?: import("../../Method.js").CanOfferFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    onPaymentSuccess?: import("../../Method.js").OnPaymentSuccessFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    name: "tempo";
    intent: "session";
    schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"open">;
                authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"topUp">;
                additionalDeposit: import("zod/mini").ZodMiniString<string>;
                channelId: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"voucher">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"close">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>], "action">;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                v1: "v1";
                v2: "v2";
            }>>;
            sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
            suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            unitType: import("zod/mini").ZodMiniString<string>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
            sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
            suggestedDeposit?: string | undefined;
            unitType: string;
        }>>;
    };
    extensions: session_.Extensions;
} | import("../../Method.js").Server<{
    readonly name: "tempo";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                hash: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"hash">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"proof">;
            }, import("zod/v4/core").$strip>], "type">;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            machineTokenEnabled: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniBoolean<boolean>>;
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            memo: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNever>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            splits: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                memo: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniTransform<`0x${string}`, string>>;
            }, import("zod/v4/core").$strip>>>;
            supportedModes: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniEnum<{
                pull: "pull";
                push: "push";
            }>>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
}, charge_.DeriveDefaults<Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
    currency: string;
    decimals: number;
    chainId: number;
}>, undefined, {}, string | undefined>)[]];
type SharedParameters = Omit<charge_.Parameters, 'machineTokenEnabled'> & session_.Parameters & {
    /** Enables MACH funding for compatible Tempo methods. Currently applies to `charge`. */
    machineTokenEnabled?: boolean | undefined;
};
export declare namespace tempo {
    /** An accepted address or chain-indexed USD token definition from `viem/tokens`. */
    type Currency = Currencies.Currency;
    /** Shared charge/session configuration with mutually exclusive currency options. */
    type Parameters = Omit<SharedParameters, 'currency'> & ({
        /** @deprecated Use `currencies: [currency]` instead. */
        currency?: string | undefined;
        currencies?: undefined;
    } | {
        currency?: undefined;
        /** Ordered accepted currencies. Replaces defaults; filters token definitions by chain and USD denomination. */
        currencies: readonly Currency[];
    });
    /** Tempo API relay configuration for server-side charges. */
    type RelayOptions = charge_.RelayOptions;
    /** Stable failure codes returned by Tempo API's MPP relay. */
    type RelayErrorCode = Relay_.configure.ErrorCode;
    /** Safe relay failure details exposed by the Tempo API relay. */
    type RelayErrorDetails = Relay_.configure.ErrorDetails;
    /** Creates ordered Tempo charge offers: OUSD first, then the network fallback. */
    const charge: typeof chargeOffers;
    /** Creates the common Tempo `charge` and `session` methods from shared parameters. */
    const common: typeof tempo;
    /** Creates ordered TIP-1034 session offers with shared storage and settlement helpers. */
    const session: typeof sessionOffers & {
        charge: typeof sessionCharge_;
        settle: typeof settle_;
        settleBatch: typeof settleBatch_;
    };
    /** Creates ordered subscription offers. Existing subscriptions retain their authorized currency. */
    const subscription: typeof subscriptionOffers;
    /** Renews an overdue Tempo subscription outside of the HTTP request path. */
    const renewSubscription: typeof renewSubscription_;
    /** One-shot settle: reads highest voucher from storage and submits on-chain. */
    const settle: typeof settle_;
    /** Batch-settle precompile-backed session channels. */
    const settleBatch: typeof settleBatch_;
    /** Types for Tempo session streams. */
    namespace Sse {
        /** Controller passed to manual-charge SSE generators. */
        type SessionController = SessionController_;
    }
    /** Experimental websocket helpers for Tempo sessions. */
    const Ws: typeof Ws_;
}
/** Currency selection shared by the public Tempo intent factories. */
type CurrencyParameters<parameters> = Omit<parameters, 'currency'> & ({
    /** @deprecated Use `currencies: [currency]` instead. */
    currency?: string | undefined;
    currencies?: undefined;
} | {
    currency?: undefined;
    currencies: readonly Currencies.Currency[];
});
/** Creates OUSD-first charge offers, with explicit currency lists replacing the defaults. */
declare function chargeOffers<const parameters extends CurrencyParameters<charge_.Parameters>>(parameters?: NoExtraKeys<parameters, CurrencyParameters<charge_.Parameters>>): readonly [import("../../Method.js").Server<{
    readonly name: "tempo";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                hash: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"hash">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"proof">;
            }, import("zod/v4/core").$strip>], "type">;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            machineTokenEnabled: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniBoolean<boolean>>;
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            memo: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNever>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            splits: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                memo: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniTransform<`0x${string}`, string>>;
            }, import("zod/v4/core").$strip>>>;
            supportedModes: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniEnum<{
                pull: "pull";
                push: "push";
            }>>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
}, charge_.DeriveDefaults<Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
    currency: string;
    decimals: number;
    chainId: number;
}>, undefined, {}, string | undefined>, ...import("../../Method.js").Server<{
    readonly name: "tempo";
    readonly intent: "charge";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                hash: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"hash">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                signature: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"proof">;
            }, import("zod/v4/core").$strip>], "type">;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            machineTokenEnabled: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniBoolean<boolean>>;
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            description: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            externalId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            memo: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNever>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            splits: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                memo: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniString<string>, import("zod/mini").ZodMiniTransform<`0x${string}`, string>>;
            }, import("zod/v4/core").$strip>>>;
            supportedModes: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniArray<import("zod/mini").ZodMiniEnum<{
                pull: "pull";
                push: "push";
            }>>>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
}, charge_.DeriveDefaults<Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
    currency: string;
    decimals: number;
    chainId: number;
}>, undefined, {}, string | undefined>[]];
/** Creates OUSD-first session offers with shared storage and currency-aware settlement helpers. */
declare function sessionOffers<const parameters extends CurrencyParameters<session_.Parameters>>(parameters?: NoExtraKeys<parameters, CurrencyParameters<session_.Parameters>>): readonly [{
    alias?: undefined;
    authorize?: import("../../Method.js").AuthorizeFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    defaults?: session_.DeriveDefaults<Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
        currency: string;
        decimals: number;
        chainId: number;
    } & {
        store: Store.AtomicStore<Store.StoreItemMap>;
    }> | undefined;
    html?: import("../../server/internal/html/config.js").Options | undefined;
    preflight?: import("../../Method.js").PreflightFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    request?: import("../../Method.js").RequestFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    respond?: import("../../Method.js").RespondFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    broadcast?: import("../../Method.js").BroadcastFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    stableBinding?: import("../../Method.js").StableBindingFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    transport?: ((Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
        currency: string;
        decimals: number;
        chainId: number;
    } & {
        store: Store.AtomicStore<Store.StoreItemMap>;
    })["sse"] extends false | undefined ? undefined : import("./internal/transport.js").Sse) | undefined;
    validate?: import("../../Method.js").ValidateFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    verify: import("../../Method.js").VerifyFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }>;
    canOffer?: import("../../Method.js").CanOfferFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    onPaymentSuccess?: import("../../Method.js").OnPaymentSuccessFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    name: "tempo";
    intent: "session";
    schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"open">;
                authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"topUp">;
                additionalDeposit: import("zod/mini").ZodMiniString<string>;
                channelId: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"voucher">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"close">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>], "action">;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                v1: "v1";
                v2: "v2";
            }>>;
            sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
            suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            unitType: import("zod/mini").ZodMiniString<string>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
            sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
            suggestedDeposit?: string | undefined;
            unitType: string;
        }>>;
    };
    extensions: session_.Extensions;
}, ...{
    alias?: undefined;
    authorize?: import("../../Method.js").AuthorizeFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    defaults?: session_.DeriveDefaults<Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
        currency: string;
        decimals: number;
        chainId: number;
    } & {
        store: Store.AtomicStore<Store.StoreItemMap>;
    }> | undefined;
    html?: import("../../server/internal/html/config.js").Options | undefined;
    preflight?: import("../../Method.js").PreflightFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    request?: import("../../Method.js").RequestFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    respond?: import("../../Method.js").RespondFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    broadcast?: import("../../Method.js").BroadcastFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    stableBinding?: import("../../Method.js").StableBindingFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    transport?: ((Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
        currency: string;
        decimals: number;
        chainId: number;
    } & {
        store: Store.AtomicStore<Store.StoreItemMap>;
    })["sse"] extends false | undefined ? undefined : import("./internal/transport.js").Sse) | undefined;
    validate?: import("../../Method.js").ValidateFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    verify: import("../../Method.js").VerifyFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }>;
    canOffer?: import("../../Method.js").CanOfferFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    onPaymentSuccess?: import("../../Method.js").OnPaymentSuccessFn<{
        readonly name: "tempo";
        readonly intent: "session";
        readonly schema: {
            credential: {
                payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"open">;
                    authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"topUp">;
                    additionalDeposit: import("zod/mini").ZodMiniString<string>;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    transaction: import("zod/mini").ZodMiniString<string>;
                    type: import("zod/mini").ZodMiniLiteral<"transaction">;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"voucher">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                    action: import("zod/mini").ZodMiniLiteral<"close">;
                    channelId: import("zod/mini").ZodMiniString<string>;
                    cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                    signature: import("zod/mini").ZodMiniString<string>;
                }, import("zod/v4/core").$strip>], "action">;
            };
            request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
                amount: import("zod/mini").ZodMiniString<string>;
                chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
                channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                currency: import("zod/mini").ZodMiniString<string>;
                decimals: import("zod/mini").ZodMiniNumber<number>;
                escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
                feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                    v1: "v1";
                    v2: "v2";
                }>>;
                sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
                suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                unitType: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                    sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
                suggestedDeposit?: string | undefined;
                unitType: string;
            }>>;
        };
    }> | undefined;
    name: "tempo";
    intent: "session";
    schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"open">;
                authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"topUp">;
                additionalDeposit: import("zod/mini").ZodMiniString<string>;
                channelId: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"voucher">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"close">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/precompile/Protocol.js").ChannelDescriptor, import("../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>], "action">;
        };
        request: import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniObject<{
            amount: import("zod/mini").ZodMiniString<string>;
            chainId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniNumber<number>>;
            channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            currency: import("zod/mini").ZodMiniString<string>;
            decimals: import("zod/mini").ZodMiniNumber<number>;
            escrowContract: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            feePayer: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniPipe<import("zod/mini").ZodMiniUnion<readonly [import("zod/mini").ZodMiniBoolean<boolean>, import("zod/mini").ZodMiniCustom<import("viem").Account, import("viem").Account>]>, import("zod/mini").ZodMiniTransform<boolean, boolean | import("viem").Account>>>;
            feeToken: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            minVoucherDelta: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            operator: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            recipient: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            sessionProtocol: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
                v1: "v1";
                v2: "v2";
            }>>;
            sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../session/Snapshot.js").SessionSnapshot, import("../session/Snapshot.js").SessionSnapshot>>;
            suggestedDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
            unitType: import("zod/mini").ZodMiniString<string>;
        }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniTransform<{
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
                sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
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
            sessionSnapshot?: import("../session/Snapshot.js").SessionSnapshot | undefined;
            suggestedDeposit?: string | undefined;
            unitType: string;
        }>>;
    };
    extensions: session_.Extensions;
}[]];
/** Offers currencies for new subscriptions; stored subscriptions retain their authorized currency. */
declare function subscriptionOffers<const parameters extends CurrencyParameters<subscription_.Parameters>>(parameters: NoExtraKeys<parameters, CurrencyParameters<subscription_.Parameters>>): readonly [import("../../Method.js").Server<{
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
}, subscription_.DeriveDefaults<Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
    currency: string;
    decimals: number;
    chainId: number;
} & {
    store: Store.AtomicStore<Record<string, unknown>>;
} & import("../internal/account.js").resolve.Parameters & import("../../viem/Client.js").getResolver.Parameters & {
    accessKey?: ((parameters: {
        input: Request;
        request: {
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
        };
        resolved: subscription_.ResolvedSubscription;
    }) => import("../../internal/types.js").MaybePromise<import("../subscription/Types.js").SubscriptionAccessKey>) | undefined;
    activationTimeoutMs?: number | undefined;
    renewalTimeoutMs?: number | undefined;
    requireCredential?: boolean | undefined;
    feePayerPolicy?: Partial<import("../internal/fee-payer.js").Policy> | undefined;
    activate?: ((parameters: {
        accessKey: import("../subscription/Types.js").SubscriptionAccessKey;
        credential: {
            payload: import("../subscription/Types.js").SubscriptionCredentialPayload;
            source?: string | undefined;
        };
        input: Request;
        request: {
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
        };
        resolved: subscription_.ResolvedSubscription;
        source: {
            address: import("viem").Address;
            chainId: number;
        } | null;
    }) => Promise<subscription_.ActivationResult>) | undefined;
    hooks?: {
        activated?: ((parameters: {
            receipt: import("../subscription/Types.js").SubscriptionReceipt;
            subscription: import("../subscription/Types.js").SubscriptionRecord;
        }) => import("../../internal/types.js").MaybePromise<void>) | undefined;
        renewed?: ((parameters: {
            periodIndex: number;
            receipt: import("../subscription/Types.js").SubscriptionReceipt;
            subscription: import("../subscription/Types.js").SubscriptionRecord;
        }) => import("../../internal/types.js").MaybePromise<void>) | undefined;
    } | undefined;
    periodCount?: import("../Methods.js").SubscriptionPeriodCountInput | undefined;
    periodUnit?: import("../subscription/Types.js").SubscriptionPeriodUnit | undefined;
    resolve: (parameters: {
        input: Request;
        request: {
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
        };
        source?: {
            address: import("viem").Address;
            chainId: number;
        } | undefined;
    }) => import("../../internal/types.js").MaybePromise<subscription_.ResolvedSubscription | null>;
    renew?: (parameters: {
        inFlightReference: string;
        periodIndex: number;
        subscription: import("../subscription/Types.js").SubscriptionRecord;
    }) => Promise<subscription_.RenewalResult>;
    store?: Store.AtomicStore<Record<string, unknown>> | undefined;
    storeKeyPrefix?: string | undefined;
    testnet?: boolean | undefined;
    waitForConfirmation?: boolean | undefined;
} & subscription_.Defaults & import("../../Method.js").ComposableHooks<{
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
}>>, undefined, subscription_.Extensions, undefined>, ...import("../../Method.js").Server<{
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
}, subscription_.DeriveDefaults<Omit<parameters, "chainId" | "currencies" | "currency" | "decimals"> & {
    currency: string;
    decimals: number;
    chainId: number;
} & {
    store: Store.AtomicStore<Record<string, unknown>>;
} & import("../internal/account.js").resolve.Parameters & import("../../viem/Client.js").getResolver.Parameters & {
    accessKey?: ((parameters: {
        input: Request;
        request: {
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
        };
        resolved: subscription_.ResolvedSubscription;
    }) => import("../../internal/types.js").MaybePromise<import("../subscription/Types.js").SubscriptionAccessKey>) | undefined;
    activationTimeoutMs?: number | undefined;
    renewalTimeoutMs?: number | undefined;
    requireCredential?: boolean | undefined;
    feePayerPolicy?: Partial<import("../internal/fee-payer.js").Policy> | undefined;
    activate?: ((parameters: {
        accessKey: import("../subscription/Types.js").SubscriptionAccessKey;
        credential: {
            payload: import("../subscription/Types.js").SubscriptionCredentialPayload;
            source?: string | undefined;
        };
        input: Request;
        request: {
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
        };
        resolved: subscription_.ResolvedSubscription;
        source: {
            address: import("viem").Address;
            chainId: number;
        } | null;
    }) => Promise<subscription_.ActivationResult>) | undefined;
    hooks?: {
        activated?: ((parameters: {
            receipt: import("../subscription/Types.js").SubscriptionReceipt;
            subscription: import("../subscription/Types.js").SubscriptionRecord;
        }) => import("../../internal/types.js").MaybePromise<void>) | undefined;
        renewed?: ((parameters: {
            periodIndex: number;
            receipt: import("../subscription/Types.js").SubscriptionReceipt;
            subscription: import("../subscription/Types.js").SubscriptionRecord;
        }) => import("../../internal/types.js").MaybePromise<void>) | undefined;
    } | undefined;
    periodCount?: import("../Methods.js").SubscriptionPeriodCountInput | undefined;
    periodUnit?: import("../subscription/Types.js").SubscriptionPeriodUnit | undefined;
    resolve: (parameters: {
        input: Request;
        request: {
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
        };
        source?: {
            address: import("viem").Address;
            chainId: number;
        } | undefined;
    }) => import("../../internal/types.js").MaybePromise<subscription_.ResolvedSubscription | null>;
    renew?: (parameters: {
        inFlightReference: string;
        periodIndex: number;
        subscription: import("../subscription/Types.js").SubscriptionRecord;
    }) => Promise<subscription_.RenewalResult>;
    store?: Store.AtomicStore<Record<string, unknown>> | undefined;
    storeKeyPrefix?: string | undefined;
    testnet?: boolean | undefined;
    waitForConfirmation?: boolean | undefined;
} & subscription_.Defaults & import("../../Method.js").ComposableHooks<{
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
}>>, undefined, subscription_.Extensions, undefined>[]];
export {};
//# sourceMappingURL=Methods.d.ts.map