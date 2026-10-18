import type { Address } from 'viem';
import type { MaybePromise } from '../../../internal/types.js';
import type { ChannelEntry } from './ChannelOps.js';
/** Store of reusable payer session channels keyed by payment scope. */
export type ChannelStore = {
    /** Returns the channel cached for `key`, when present. */
    get(key: string): MaybePromise<ChannelEntry | undefined>;
    /** Inserts or replaces a channel entry. */
    set(entry: ChannelEntry): MaybePromise<void>;
    /** Removes the channel cached for `key`. */
    delete(key: string): MaybePromise<void>;
};
/** Channel persistence and update notification for credential results. */
export type ChannelSink = {
    store: ChannelStore;
    notifyUpdate: (entry: ChannelEntry) => void;
};
/** Returns the scope key for a reusable payer session channel. */
export declare function channelKey(scope: {
    payee: Address;
    token: Address;
    escrow: Address;
    chainId: number;
}): string;
/** Returns the scope key for a stored channel entry. */
export declare function entryKey(entry: ChannelEntry): string;
/** Creates the default in-memory {@link ChannelStore}. */
export declare function createChannelStore(): ChannelStore;
/** JSON-safe projection of a {@link ChannelEntry}, with bigint amounts as decimal strings. */
export type StoredChannel = Omit<ChannelEntry, 'cumulativeAmount' | 'deposit'> & {
    /** Cumulative voucher authorization in raw token units, as a decimal string. */
    cumulativeAmount: string;
    /** Channel deposit in raw token units, as a decimal string. */
    deposit: string;
};
/** Converts a channel entry into its JSON-safe stored form. */
export declare function serializeEntry(entry: ChannelEntry): StoredChannel;
/** Restores a channel entry from its JSON-safe stored form. */
export declare function deserializeEntry(stored: StoredChannel): ChannelEntry;
/** Plain string key-value backend a {@link createJsonChannelStore} persists into. */
export type JsonChannelKv = {
    /** Returns the value stored at `key`, when present. */
    get(key: string): MaybePromise<string | undefined>;
    /** Persists a `value` at `key`. */
    set(key: string, value: string): MaybePromise<void>;
    /** Removes the value stored at `key`. */
    delete(key: string): MaybePromise<void>;
};
/** Wraps a string KV backend as a bigint-safe channel store. */
export declare function createJsonChannelStore(kv: JsonChannelKv): ChannelStore;
//# sourceMappingURL=ChannelStore.d.ts.map