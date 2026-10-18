/** Returns the scope key for a reusable payer session channel. */
export function channelKey(scope) {
    const { payee, token, escrow, chainId } = scope;
    return `${payee.toLowerCase()}:${token.toLowerCase()}:${escrow.toLowerCase()}:${chainId}`;
}
/** Returns the scope key for a stored channel entry. */
export function entryKey(entry) {
    return channelKey({
        payee: entry.descriptor.payee,
        token: entry.descriptor.token,
        escrow: entry.escrow,
        chainId: entry.chainId,
    });
}
/** Creates the default in-memory {@link ChannelStore}. */
export function createChannelStore() {
    const channels = new Map();
    return {
        get: (key) => channels.get(key),
        set(entry) {
            channels.set(entryKey(entry), entry);
        },
        delete(key) {
            channels.delete(key);
        },
    };
}
/** Converts a channel entry into its JSON-safe stored form. */
export function serializeEntry(entry) {
    return {
        ...entry,
        cumulativeAmount: entry.cumulativeAmount.toString(),
        deposit: entry.deposit.toString(),
    };
}
/** Restores a channel entry from its JSON-safe stored form. */
export function deserializeEntry(stored) {
    return {
        ...stored,
        cumulativeAmount: BigInt(stored.cumulativeAmount),
        deposit: BigInt(stored.deposit),
    };
}
/** Prefix for serialized channel entries persisted by {@link createJsonChannelStore}. */
const channelPrefix = 'chan:';
/** Wraps a string KV backend as a bigint-safe channel store. */
export function createJsonChannelStore(kv) {
    return {
        async get(key) {
            const value = await kv.get(channelPrefix + key);
            if (value === undefined)
                return undefined;
            return deserializeEntry(JSON.parse(value));
        },
        async set(entry) {
            await kv.set(channelPrefix + entryKey(entry), JSON.stringify(serializeEntry(entry)));
        },
        async delete(key) {
            await kv.delete(channelPrefix + key);
        },
    };
}
//# sourceMappingURL=ChannelStore.js.map