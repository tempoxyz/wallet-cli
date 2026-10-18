import { type Address } from 'viem';
import * as Method from '../../../Method.js';
import * as Account from '../../../viem/Account.js';
import * as Client from '../../../viem/Client.js';
import type { ResolveAccount as ResolveAccount_, ResolveAccountInfo as ResolveAccountInfo_ } from '../../client/ResolveAccount.js';
import * as AutoSwap from '../../internal/auto-swap.js';
import * as Channel from '../precompile/Channel.js';
import { type ChannelEntry } from './ChannelOps.js';
import { type ChannelStore } from './ChannelStore.js';
export { sessionContextSchema, type SessionContext } from './CredentialState.js';
/**
 * Creates the low-level TIP-1034 session payment method for use with `Mppx.create()`.
 *
 * Supports auto mode (server hints drive open/top-up sizing, with optional
 * `maxDeposit` as a local cap) and manual mode (`context.action` with a
 * channel descriptor).
 */
export declare function session(parameters?: session.Parameters): Method.Client<{
    readonly name: "tempo";
    readonly intent: "session";
    readonly schema: {
        credential: {
            payload: import("zod/mini").ZodMiniDiscriminatedUnion<[import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"open">;
                authorizedSigner: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<Channel.ChannelDescriptor, Channel.ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"topUp">;
                additionalDeposit: import("zod/mini").ZodMiniString<string>;
                channelId: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<Channel.ChannelDescriptor, Channel.ChannelDescriptor>>;
                transaction: import("zod/mini").ZodMiniString<string>;
                type: import("zod/mini").ZodMiniLiteral<"transaction">;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"voucher">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<Channel.ChannelDescriptor, Channel.ChannelDescriptor>>;
                signature: import("zod/mini").ZodMiniString<string>;
            }, import("zod/v4/core").$strip>, import("zod/mini").ZodMiniObject<{
                action: import("zod/mini").ZodMiniLiteral<"close">;
                channelId: import("zod/mini").ZodMiniString<string>;
                cumulativeAmount: import("zod/mini").ZodMiniString<string>;
                descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<Channel.ChannelDescriptor, Channel.ChannelDescriptor>>;
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
            sessionSnapshot: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<import("./Runtime.js").SessionSnapshot, import("./Runtime.js").SessionSnapshot>>;
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
                sessionSnapshot?: import("./Runtime.js").SessionSnapshot | undefined;
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
            sessionSnapshot?: import("./Runtime.js").SessionSnapshot | undefined;
            suggestedDeposit?: string | undefined;
            unitType: string;
        }>>;
    };
}, import("zod/mini").ZodMiniObject<{
    account: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<`0x${string}` | Account.Account | undefined, `0x${string}` | Account.Account | undefined>>;
    autoSwap: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<AutoSwap.resolve.Value, AutoSwap.resolve.Value>>;
    action: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniEnum<{
        close: "close";
        open: "open";
        topUp: "topUp";
        voucher: "voucher";
    }>>;
    channelId: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<`0x${string}`, `0x${string}`>>;
    cumulativeAmount: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
    cumulativeAmountRaw: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
    transaction: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<`0x${string}`, `0x${string}`>>;
    descriptor: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniCustom<Channel.ChannelDescriptor, Channel.ChannelDescriptor>>;
    additionalDeposit: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
    additionalDepositRaw: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
    depositRaw: import("zod/mini").ZodMiniOptional<import("zod/mini").ZodMiniString<string>>;
}, import("zod/v4/core").$strip>>;
/** Type helpers for the low-level TIP-1034 session client method. */
export declare namespace session {
    type ResolveAccount = ResolveAccount_;
    type ResolveAccountInfo = ResolveAccountInfo_;
    type Parameters = Account.getResolver.Parameters & Client.getResolver.Parameters & {
        /** Accept a noncanonical escrow contract advertised by the server. @default false */
        allowCustomEscrow?: boolean | undefined;
        /** Automatically acquire the session currency from fallback stablecoins before open/top-up. */
        autoSwap?: AutoSwap.resolve.Value | undefined;
        /** Pluggable persistence for reusable channels. Defaults to an in-memory store. */
        channelStore?: ChannelStore | undefined;
        /** Token decimals for parsing human-readable amounts (default: 6). */
        decimals?: number | undefined;
        /** Exact TIP20EscrowChannel address pin. Takes precedence over `allowCustomEscrow`. */
        escrow?: Address | undefined;
        /**
         * Chains permitted for session credentials. Omitted allows any chain; empty rejects all.
         * A single entry supplies the chain when omitted by the challenge. Otherwise the
         * challenge or resolved client must select an allowed chain.
         */
        allowedChainIds?: readonly number[] | undefined;
        /** Maximum channel deposit in human-readable units. Caps server-suggested opens and automatic top-ups. */
        maxDeposit?: string | undefined;
        /**
         * Preferred automatic top-up size in human-readable units. When omitted,
         * a bounded server `suggestedDeposit` is preferred, then the exact shortfall.
         */
        topUpAmount?: string | undefined;
        /** Called whenever channel state changes. */
        onChannelUpdate?: ((entry: ChannelEntry) => void) | undefined;
        /** Selects the account that signs this session credential after the challenge is known. */
        resolveAccount?: ResolveAccount | undefined;
    };
}
//# sourceMappingURL=Session.d.ts.map