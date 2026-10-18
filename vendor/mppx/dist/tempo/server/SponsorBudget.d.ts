import type { Hex } from 'viem';
import type * as Store from '../../Store.js';
export type Phase = 'prepared' | 'broadcasting' | 'pending';
export type Reservation = {
    expiresAt: number;
    fee: string;
    leaseUntil: number;
    owner: string;
    phase: Phase;
    transactionHash: Hex;
};
export type State = {
    reservations: Record<string, Reservation>;
    version: 1;
};
export type Handle = {
    chainId: number;
    id: string;
    owner: string;
    sponsor: Hex;
};
type ItemMap = {
    [key: `mppx:charge:sponsor-budget:${string}`]: State;
};
type ReserveParameters = Handle & {
    expiresAt: number;
    fee: bigint;
    getReceipt: (hash: Hex) => Promise<unknown>;
    maxReservations: number;
    maxTotalFee: bigint;
    transactionHash: Hex;
    waitUntil: number;
};
/**
 * Reserves aggregate sponsor fee capacity across processes.
 *
 * Pending broadcasts remain charged to the budget until a receipt is observed
 * or their expiring nonce becomes invalid. Capacity waiters do not rewrite the
 * shared state while waiting.
 *
 * @internal
 */
export declare function reserve(store: Store.AtomicStore<ItemMap>, parameters: ReserveParameters): Promise<Handle>;
/**
 * Advances a reservation before and after the broadcast call.
 *
 * The owner token fences stale workers from mutating a replacement reservation.
 *
 * @internal
 */
export declare function transition(store: Store.AtomicStore<ItemMap>, handle: Handle, phase: Exclude<Phase, 'prepared'>): Promise<boolean>;
/**
 * Releases a reservation only when the caller still owns it.
 *
 * @internal
 */
export declare function release(store: Store.AtomicStore<ItemMap>, handle: Handle): Promise<boolean>;
export {};
//# sourceMappingURL=SponsorBudget.d.ts.map