import type { Hex } from 'viem';
import type { NeedVoucherEvent } from '../precompile/Protocol.js';
import * as ChannelStore from './ChannelStore.js';
/** Parameters for reserving voucher headroom before emitting a stream item. */
export type ReserveChargeParameters = {
    /** Amount required for the next stream item. */
    amount: bigint;
    /** Channel being metered. */
    channelId: Hex;
    /** Emits the transport-specific need-voucher frame. */
    emit: (message: string) => void | Promise<void>;
    /** Formats a transport-specific need-voucher frame. */
    formatNeedVoucher(parameters: NeedVoucherEvent): string;
    /** Store polling interval when `waitForUpdate` is unavailable. */
    pollIntervalMs: number;
    /** Amount already reserved but not yet committed by this stream loop. */
    reservedAmount: bigint;
    /** Optional abort signal for long waits. */
    signal?: AbortSignal | undefined;
    /** Channel store used for state reads and waits. */
    store: ChannelStore.ChannelStore;
};
/** Parameters for committing previously reserved stream charges. */
export type CommitReservedChargesParameters = {
    /** Reserved amount to commit. */
    amount: bigint;
    /** Channel being metered. */
    channelId: Hex;
    /** Channel store used for atomic updates. */
    store: ChannelStore.ChannelStore;
    /** Number of charge units to add. */
    units: number;
};
/**
 * Reserves voucher headroom for a future stream emission.
 *
 * If the channel lacks headroom, emits one need-voucher frame, then waits for
 * a store update or polling interval until the accepted voucher covers both
 * already-reserved charges and the next requested amount.
 */
export declare function reserveChargeOrWait(options: ReserveChargeParameters): Promise<void>;
/** Atomically commits previously reserved stream charges to channel spend and unit counters. */
export declare function commitReservedCharges(options: CommitReservedChargesParameters): Promise<ChannelStore.State | undefined>;
/** Throws when a channel can no longer be used for streaming charges. */
export declare function throwIfChannelClosed(channel: ChannelStore.State): void;
/** Minimal socket event map supported by browser and Node-style WebSocket runtimes. */
export type SocketEventMap = {
    close: Event | {
        code?: number | undefined;
        reason?: string | undefined;
        type?: string;
    };
    error: Event | {
        type?: string;
    };
    message: Event | {
        data: unknown;
        type?: string;
    };
};
/** Socket event listener accepted by browser and Node-style runtimes. */
export type SocketEventListener<type extends keyof SocketEventMap> = ((event: SocketEventMap[type]) => void) | {
    handleEvent(event: SocketEventMap[type]): void;
};
/** Minimal socket shape required by the session WebSocket adapter. */
export type Socket = {
    close(code?: number, reason?: string): unknown;
    send(data: string): unknown;
    addEventListener?: <type extends keyof SocketEventMap>(type: type, listener: SocketEventListener<type>) => unknown;
    removeEventListener?: <type extends keyof SocketEventMap>(type: type, listener: SocketEventListener<type>) => unknown;
    on?: <type extends keyof SocketEventMap>(type: type, listener: (event: SocketEventMap[type]) => void) => unknown;
    off?: <type extends keyof SocketEventMap>(type: type, listener: (event: SocketEventMap[type]) => void) => unknown;
};
/** Handlers for socket lifecycle and message events. */
export type SocketHandlers = {
    /** Called when the socket closes. */
    close(): void;
    /** Called when the socket reports an error. */
    error(): void;
    /** Called with raw message payloads. */
    message(payload: unknown): void;
};
/** Subscribes to browser or Node-style socket events and returns an unsubscribe callback. */
export declare function subscribe(socket: Socket, handlers: SocketHandlers): () => void;
/** Sends a text frame through sync or async socket implementations. */
export declare function send(socket: Socket, data: string): Promise<void>;
/** Converts socket message payloads into text frames when possible. */
export declare function toText(value: unknown): string | null;
//# sourceMappingURL=Transports.d.ts.map