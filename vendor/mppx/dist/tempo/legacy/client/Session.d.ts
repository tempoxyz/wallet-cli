import { type Address, type Account as viem_Account } from 'viem';
import * as Method from '../../../Method.js';
import * as Account from '../../../viem/Account.js';
import * as Client from '../../../viem/Client.js';
import * as z from '../../../zod.js';
import { type ChannelEntry } from './ChannelOps.js';
/** Runtime schema for legacy low-level session credential context. */
export declare const sessionContextSchema: z.ZodMiniObject<{
    account: z.ZodMiniOptional<z.ZodMiniCustom<`0x${string}` | Account.Account | undefined, `0x${string}` | Account.Account | undefined>>;
    action: z.ZodMiniOptional<z.ZodMiniEnum<{
        close: "close";
        open: "open";
        topUp: "topUp";
        voucher: "voucher";
    }>>;
    channelId: z.ZodMiniOptional<z.ZodMiniString<string>>;
    cumulativeAmount: z.ZodMiniOptional<z.ZodMiniString<string>>;
    cumulativeAmountRaw: z.ZodMiniOptional<z.ZodMiniString<string>>;
    transaction: z.ZodMiniOptional<z.ZodMiniString<string>>;
    additionalDeposit: z.ZodMiniOptional<z.ZodMiniString<string>>;
    additionalDepositRaw: z.ZodMiniOptional<z.ZodMiniString<string>>;
    depositRaw: z.ZodMiniOptional<z.ZodMiniString<string>>;
}, z.core.$strip>;
/** Context accepted by the legacy low-level session client method. */
export type SessionContext = z.infer<typeof sessionContextSchema>;
/**
 * Creates a session payment method for use with `Mppx.create()`.
 *
 * Supports both auto mode (set `deposit` to manage channels automatically)
 * and manual mode (pass `context.action` to control each step).
 *
 * @example
 * ```ts
 * // Auto mode
 * import { Mppx, tempo } from 'mppx/client'
 *
 * const mppx = Mppx.create({
 *   methods: [tempo({
 *     account: privateKeyToAccount('0x...'),
 *     deposit: '10',
 *   })],
 * })
 *
 * const res = await mppx.fetch('/api/chat?prompt=hello')
 * ```
 *
 * @example
 * ```ts
 * // Manual mode
 * const mppx = Mppx.create({
 *   methods: [tempo({ account })],
 * })
 *
 * const credential = await mppx.createCredential(response, {
 *   action: 'voucher',
 *   channelId: '0x...',
 *   cumulativeAmount: '1',
 * })
 * ```
 */
export declare function session(parameters?: session.Parameters): Method.Client<{
    readonly name: "tempo";
    readonly intent: "session";
    readonly schema: {
        credential: {
            payload: z.ZodMiniDiscriminatedUnion<[z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"open">;
                authorizedSigner: z.ZodMiniOptional<z.ZodMiniString<string>>;
                channelId: z.ZodMiniString<string>;
                cumulativeAmount: z.ZodMiniString<string>;
                descriptor: z.ZodMiniOptional<z.ZodMiniCustom<import("../../session/precompile/Protocol.js").ChannelDescriptor, import("../../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: z.ZodMiniString<string>;
                transaction: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"transaction">;
            }, z.core.$strip>, z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"topUp">;
                additionalDeposit: z.ZodMiniString<string>;
                channelId: z.ZodMiniString<string>;
                descriptor: z.ZodMiniOptional<z.ZodMiniCustom<import("../../session/precompile/Protocol.js").ChannelDescriptor, import("../../session/precompile/Protocol.js").ChannelDescriptor>>;
                transaction: z.ZodMiniString<string>;
                type: z.ZodMiniLiteral<"transaction">;
            }, z.core.$strip>, z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"voucher">;
                channelId: z.ZodMiniString<string>;
                cumulativeAmount: z.ZodMiniString<string>;
                descriptor: z.ZodMiniOptional<z.ZodMiniCustom<import("../../session/precompile/Protocol.js").ChannelDescriptor, import("../../session/precompile/Protocol.js").ChannelDescriptor>>;
                signature: z.ZodMiniString<string>;
            }, z.core.$strip>, z.ZodMiniObject<{
                action: z.ZodMiniLiteral<"close">;
                channelId: z.ZodMiniString<string>;
                cumulativeAmount: z.ZodMiniString<string>;
                descriptor: z.ZodMiniOptional<z.ZodMiniCustom<import("../../session/precompile/Protocol.js").ChannelDescriptor, import("../../session/precompile/Protocol.js").ChannelDescriptor>>;
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
            feePayer: z.ZodMiniOptional<z.ZodMiniPipe<z.ZodMiniUnion<readonly [z.ZodMiniBoolean<boolean>, z.ZodMiniCustom<viem_Account, viem_Account>]>, z.ZodMiniTransform<boolean, boolean | viem_Account>>>;
            feeToken: z.ZodMiniOptional<z.ZodMiniString<string>>;
            minVoucherDelta: z.ZodMiniOptional<z.ZodMiniString<string>>;
            operator: z.ZodMiniOptional<z.ZodMiniString<string>>;
            recipient: z.ZodMiniOptional<z.ZodMiniString<string>>;
            sessionProtocol: z.ZodMiniOptional<z.ZodMiniEnum<{
                v1: "v1";
                v2: "v2";
            }>>;
            sessionSnapshot: z.ZodMiniOptional<z.ZodMiniCustom<import("../../session/Snapshot.js").SessionSnapshot, import("../../session/Snapshot.js").SessionSnapshot>>;
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
                sessionSnapshot?: import("../../session/Snapshot.js").SessionSnapshot | undefined;
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
            sessionSnapshot?: import("../../session/Snapshot.js").SessionSnapshot | undefined;
            suggestedDeposit?: string | undefined;
            unitType: string;
        }>>;
    };
}, z.ZodMiniObject<{
    account: z.ZodMiniOptional<z.ZodMiniCustom<`0x${string}` | Account.Account | undefined, `0x${string}` | Account.Account | undefined>>;
    action: z.ZodMiniOptional<z.ZodMiniEnum<{
        close: "close";
        open: "open";
        topUp: "topUp";
        voucher: "voucher";
    }>>;
    channelId: z.ZodMiniOptional<z.ZodMiniString<string>>;
    cumulativeAmount: z.ZodMiniOptional<z.ZodMiniString<string>>;
    cumulativeAmountRaw: z.ZodMiniOptional<z.ZodMiniString<string>>;
    transaction: z.ZodMiniOptional<z.ZodMiniString<string>>;
    additionalDeposit: z.ZodMiniOptional<z.ZodMiniString<string>>;
    additionalDepositRaw: z.ZodMiniOptional<z.ZodMiniString<string>>;
    depositRaw: z.ZodMiniOptional<z.ZodMiniString<string>>;
}, z.core.$strip>>;
/** Type helpers for the legacy low-level session client method. */
export declare namespace session {
    type Parameters = Account.getResolver.Parameters & Client.getResolver.Parameters & {
        /** Accept a noncanonical escrow contract advertised by the server. @default false */
        allowCustomEscrow?: boolean | undefined;
        /** Account that signs voucher digests. Defaults to `account`; access-key accounts sign raw vouchers as their access-key address. */
        voucherSigner?: viem_Account | undefined;
        /** Token decimals for parsing human-readable amounts (default: 6). */
        decimals?: number | undefined;
        /** Initial deposit amount in human-readable units (e.g. "10" for 10 tokens). When set, the method handles the full channel lifecycle (open, voucher, cumulative tracking) automatically. */
        deposit?: string | undefined;
        /** Exact escrow contract address pin. Takes precedence over `allowCustomEscrow`. */
        escrowContract?: Address | undefined;
        /** Maximum deposit in human-readable units (e.g. "10"). Caps the server's `suggestedDeposit`. Enables auto-management like `deposit`. */
        maxDeposit?: string | undefined;
        /** Called whenever channel state changes (open, voucher, close, recovery). */
        onChannelUpdate?: ((entry: ChannelEntry) => void) | undefined;
    };
}
//# sourceMappingURL=Session.d.ts.map