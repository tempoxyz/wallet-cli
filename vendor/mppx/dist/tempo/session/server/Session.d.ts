/**
 * Server-side TIP-1034 precompile session payment method for request/response flows.
 *
 * Handles the full TIP20EscrowChannel lifecycle (open, voucher, top-up, close)
 * and one-shot settlement. Each incoming request carries a session credential
 * with a cumulative voucher that the server validates and records.
 */
import { type Address, type Hex } from 'viem';
import type { LooseOmit, NoExtraKeys } from '../../../internal/types.js';
import * as Method from '../../../Method.js';
import * as Store from '../../../Store.js';
import * as Client from '../../../viem/Client.js';
import * as Account from '../../internal/account.js';
import * as FeePayer from '../../internal/fee-payer.js';
import type * as types from '../../internal/types.js';
import * as Methods from '../../Methods.js';
import * as Transport from '../../server/internal/transport.js';
import { deserializeSnapshot as deserializeSessionSnapshot, serializeSnapshot as serializeSessionSnapshot } from '../Snapshot.js';
import * as ChannelStore from './ChannelStore.js';
import { type ResolveSessionChannelId } from './RequestState.js';
import { type SettleChargedSessionChannel } from './Settlement.js';
import { type OnSessionSettlement, type SettlementSchedule } from './Settlement.js';
import * as Ws from './Ws.js';
/** Server-side automatic settlement schedule. */
export type { SettlementSchedule } from './Settlement.js';
/** Server-side settlement event hook types. */
export type { OnSessionSettlement, SessionSettlementContext } from './Settlement.js';
/** Server-side hook types for request-identity channel bootstrap. */
export type { ResolveSessionChannelId, ResolveSessionChannelIdParameters, SessionChannelIdRequest, } from './RequestState.js';
export { settle, settleBatch } from './Settlement.js';
/** Creates a server-side TIP20EscrowChannel precompile session payment method. */
export declare function session<const parameters extends session.Parameters>(p?: NoExtraKeys<parameters, session.Parameters>): Method.Server<{
    readonly name: "tempo";
    readonly intent: "session";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"open">;
                authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../precompile/Protocol.js").ChannelDescriptor, import("../precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"topUp">;
                additionalDeposit: import("zod/mini").ZodMiniString<string>;
                channelId: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../precompile/Protocol.js").ChannelDescriptor, import("../precompile/Protocol.js").ChannelDescriptor>>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"voucher">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../precompile/Protocol.js").ChannelDescriptor, import("../precompile/Protocol.js").ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"close">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../precompile/Protocol.js").ChannelDescriptor, import("../precompile/Protocol.js").ChannelDescriptor>>;
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
            sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("../Snapshot.js").SessionSnapshot, import("../Snapshot.js").SessionSnapshot>>;
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
                sessionSnapshot?: import("../Snapshot.js").SessionSnapshot | undefined;
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
            sessionSnapshot?: import("../Snapshot.js").SessionSnapshot | undefined;
            suggestedDeposit?: string | undefined;
            unitType: string;
        }>>;
    };
}, session.DeriveDefaults<parameters>, parameters["sse"] extends false | undefined ? undefined : Transport.Sse, session.Extensions, undefined>;
export declare namespace session {
    const serializeSnapshot: typeof serializeSessionSnapshot;
    const deserializeSnapshot: typeof deserializeSessionSnapshot;
    /** Extensions attached to the Tempo session method handler. */
    type Extensions = {
        /** Applies the configured automatic settlement policy to a committed channel charge. */
        settleScheduled: SettleChargedSessionChannel;
        /** Serves a WebSocket route from this handler using its configured store and settlement policy. */
        serveWebSocket: (options: ServeWebSocketOptions) => Promise<void>;
    };
    /** WebSocket server options supplied after the session binds shared dependencies. */
    type ServeWebSocketOptions = Omit<Ws.serve.Options, 'onChargeCommitted' | 'settleScheduled' | 'store'>;
    /** Request defaults inferred from the Tempo session method schema. */
    type Defaults = LooseOmit<Method.RequestDefaults<typeof Methods.session>, 'escrowContract' | 'feePayer' | 'recipient'>;
    /** Partial fee-sponsor policy used for server-submitted session transactions. */
    type FeePayerPolicy = Partial<FeePayer.Policy>;
    /** Parameters accepted by the TIP-1034 server session payment method. */
    type Parameters = {
        /** TTL in milliseconds for cached on-chain channel state. After this duration, the server re-queries on-chain state during voucher handling to detect forced close requests. @default 5_000 */
        channelStateTtl?: number | undefined;
        /** Override the fee-sponsor policy used for sponsored open/topUp transactions and server-driven close transactions. */
        feePayerPolicy?: FeePayerPolicy | undefined;
        /** Minimum voucher delta to accept (numeric string, default: "0"). */
        minVoucherDelta?: string | undefined;
        /**
         * Maps authenticated application identity and payment scope to an existing channel ID.
         * Called only when the request does not already supply a channel ID. MPPx then loads that
         * ID from `store` and validates the channel before including its snapshot in a challenge or
         * bootstrap response. The store is not searched automatically and does not need to implement
         * a secondary-index format.
         */
        resolveChannelId?: ResolveSessionChannelId | undefined;
        /**
         * Enables same-route `HEAD` recovery before a paid request. The server issues a zero-amount
         * identity challenge, verifies the returned proof, passes its authenticated `source` to
         * `resolveChannelId`, validates the loaded channel's payment scope, and returns a snapshot
         * containing the signed highest voucher for client rehydration.
         */
        bootstrap?: boolean | undefined;
        /**
         * Atomic store backend for channel state.
         *
         * Session mutations must be linearizable across instances so spent,
         * highest-voucher, top-up, and close/finalization updates cannot race.
         * Use `Store.memory()` for tests or local single-process usage.
         */
        store?: Store.AtomicStore | undefined;
        /** Enable SSE streaming. Pass `true` for defaults or an options object to configure SSE. */
        sse?: boolean | Transport.sse.Options | undefined;
        /** Tempo chain ID used for TIP-1034 channel escrow challenges. Defaults to the resolved client chain ID. */
        chainId?: number | undefined;
        /** Escrow contract advertised to clients. Defaults to the canonical TIP20EscrowChannel address. */
        escrowContract?: Address | undefined;
        /** Callback invoked after any on-chain settlement or close transaction is confirmed. */
        onSessionSettlement?: OnSessionSettlement | undefined;
        /** Server-owned automatic settlement cadence. Clients do not receive or control this schedule. */
        settlementSchedule?: SettlementSchedule | undefined;
        /** Optional fee token for management and server-driven settle/close transactions. */
        feeToken?: Address | undefined;
    } & Account.resolve.Parameters & Client.getResolver.Parameters & Defaults & Method.ComposableHooks<typeof Methods.session>;
    /** Defaults derived from `session()` parameters for handler type inference. */
    type DeriveDefaults<parameters extends Parameters> = types.DeriveDefaults<parameters, Defaults, {
        currency: string;
        decimals: number;
    }>;
}
/**
 * Charge against a precompile-backed channel's balance.
 *
 * Exported so consumers can deduct from a channel outside the `session()`
 * handler.
 *
 * Delegates to the shared `deductFromChannel` atomic helper and translates
 * failure modes into typed errors (`InsufficientBalanceError`, `ChannelClosedError`).
 */
export declare function charge(store: ChannelStore.ChannelStore, channelId: Hex, amount: bigint): Promise<ChannelStore.State>;
//# sourceMappingURL=Session.d.ts.map