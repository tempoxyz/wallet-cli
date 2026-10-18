/**
 * Shared client-side TIP-1034 channel operations.
 *
 * Provides the low-level helpers that both `tempo.session()` and
 * `tempo.session.manager()` rely on: channel ID computation,
 * transaction-bound descriptor construction, on-chain open/top-up payload
 * construction, voucher/close payload serialization, and transaction signing.
 *
 * @see https://tips.sh/1034-1
 */
import { Hex } from 'ox';
import { type Account, type Address, type Client } from 'viem';
import type { Challenge } from '../../../Challenge.js';
import * as Channel from '../precompile/Channel.js';
import type { CloseCredentialPayload, OpenCredentialPayload, SessionCredentialPayload, TopUpCredentialPayload, VoucherCredentialPayload } from '../precompile/Protocol.js';
export type TempoChannelCall = {
    to: Address;
    data: Hex.Hex;
};
/** Client-side cached channel metadata used for automatic voucher management. */
export type ChannelEntry = {
    /** TIP-1034 channel ID derived from descriptor, escrow, and chain ID. */
    channelId: Hex.Hex;
    /** Highest cumulative amount this client has locally authorized. */
    cumulativeAmount: bigint;
    /** Latest channel deposit known by the client. */
    deposit: bigint;
    /** TIP-1034 descriptor required for vouchers, top-ups, and close credentials. */
    descriptor: Channel.ChannelDescriptor;
    /** Escrow contract address used to derive `channelId`. */
    escrow: Address;
    /** EVM chain ID used for channel ID and voucher domain separation. */
    chainId: number;
    /** Whether the client considers the channel reusable for new vouchers. */
    opened: boolean;
};
/** Resolves the voucher authority address for a client account. */
export declare function resolveAuthorizedSigner(account: Account): Address;
/** Resolves the server-advertised escrow against the client's trust policy. */
export declare function resolveEscrow(challenge: {
    request: {
        methodDetails?: unknown;
    };
}, escrowOverride?: Address | undefined, allowCustomEscrow?: boolean): Address;
/** Serializes a session credential with a DID source bound to the payer account. */
export declare function serializeCredential(challenge: Challenge, payload: SessionCredentialPayload, chainId: number, account: Account): string;
/** Case-insensitive EVM address equality. */
export declare function isSameAddress(a: Address, b: Address): boolean;
/**
 * Signs and creates a TIP-1034 voucher credential payload for an existing channel.
 *
 * @see https://tips.sh/1034-1#execution-semantics
 */
export declare function createVoucherPayload(client: Client, account: Account, descriptor: Channel.ChannelDescriptor, cumulativeAmount: bigint, chainId: number, escrow?: Address): Promise<VoucherCredentialPayload>;
/**
 * Signs and creates a TIP-1034 close credential payload for an existing channel.
 *
 * @see https://tips.sh/1034-1#execution-semantics
 */
export declare function createClosePayload(client: Client, account: Account, descriptor: Channel.ChannelDescriptor, cumulativeAmount: bigint, chainId: number, escrow?: Address): Promise<CloseCredentialPayload>;
/**
 * Prepares, signs, and creates a TIP-1034 open credential payload.
 *
 * The channel descriptor uses the signed transaction's expiring nonce hash
 * because TIP-1034 binds each opened channel to that transaction context.
 *
 * @see https://tips.sh/1034-1#channel-identity-and-packed-state
 */
export declare function createOpenPayload(client: Client, account: Account, parameters: {
    chainId: number;
    deposit: bigint;
    escrow?: Address | undefined;
    feePayer?: boolean | undefined;
    feeToken?: Address | undefined;
    initialAmount: bigint;
    operator?: Address | undefined;
    payee: Address;
    /** Calls executed atomically before the channel is opened. */
    prefixCalls?: readonly TempoChannelCall[] | undefined;
    token: Address;
}): Promise<OpenCredentialPayload>;
/**
 * Prepares, signs, and creates a TIP-1034 top-up credential payload.
 *
 * @see https://tips.sh/1034-1#execution-semantics
 */
export declare function createTopUpPayload(client: Client, account: Account, descriptor: Channel.ChannelDescriptor, additionalDeposit: bigint, chainId: number, feePayer?: boolean | undefined, escrow?: Address, prefixCalls?: readonly TempoChannelCall[], feeToken?: Address): Promise<TopUpCredentialPayload>;
//# sourceMappingURL=ChannelOps.d.ts.map