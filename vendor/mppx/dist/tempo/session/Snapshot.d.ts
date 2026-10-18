import { type Address, type Hex } from 'viem';
import type { ChannelDescriptor, RawAmountString } from './precompile/Protocol.js';
/** Server-provided reusable channel state used to bootstrap a client session. */
export type SessionSnapshot = {
    /** Highest cumulative voucher amount the server has accepted for this channel. */
    acceptedCumulative: RawAmountString;
    /** Tempo chain ID used to derive the channel ID and voucher domain. */
    chainId: number;
    /** TIP-1034 channel ID derived from descriptor, escrow address, and chain ID. */
    channelId: Hex;
    /** Timestamp when unilateral close was requested, when the channel is closing. */
    closeRequestedAt?: RawAmountString | undefined;
    /** Current on-chain deposit ceiling for cumulative voucher authorization. */
    deposit: RawAmountString;
    /** Full descriptor needed to recover the channel without client-side persistence. */
    descriptor: ChannelDescriptor;
    /** Escrow precompile address used to derive the channel ID. */
    escrow: Address;
    /** Minimum cumulative authorization needed for the challenged request or stream continuation. */
    requiredCumulative: RawAmountString;
    /** Highest client-signed voucher accepted by the server. */
    highestVoucher?: {
        /** Channel identifier bound into the voucher signature. */
        channelId: Hex;
        /** Cumulative authorization bound into the voucher signature. */
        cumulativeAmount: RawAmountString;
        /** Original client signature proving the accepted cumulative authorization. */
        signature: Hex;
    } | undefined;
    /** Amount already settled on-chain. */
    settled: RawAmountString;
    /** Amount consumed by delivered content according to server accounting. */
    spent: RawAmountString;
    /** Paid units delivered by the server, when the transport reports them. */
    units?: number | undefined;
};
/** Serializes a session snapshot for the `Payment-Session-Snapshot` header. */
export declare function serializeSnapshot(snapshot: SessionSnapshot): string;
/** Deserializes a session snapshot from the `Payment-Session-Snapshot` header. */
export declare function deserializeSnapshot(value: string): SessionSnapshot;
//# sourceMappingURL=Snapshot.d.ts.map