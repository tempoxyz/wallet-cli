/**
 * Async key-value store interface.
 *
 * Modeled after Cloudflare KV's API (`get`/`put`/`delete`).
 * Implementations handle serialization internally.
 *
 * ## Type architecture
 *
 * Uses a two-slot generic pattern inspired by Viem's `Client` type:
 *
 * - `itemMap` — constrains keys and their value types
 * - `extended` — accumulates additional capabilities (e.g., atomic `update`)
 *
 * `AtomicStore` is a type alias that fills the `extended` slot with
 * `AtomicActions`, just like Viem's `PublicClient = Client<..., PublicActions>`.
 */
import { Json } from 'ox';
/**
 * Attempts to atomically record first use of a replay key through its expiry.
 *
 * Returns `true` when this call recorded the key and `false` when it was already
 * recorded and unexpired. `expires` is a Unix timestamp in milliseconds.
 * Uses the adapter's optimized primitive when available and otherwise falls
 * back to {@link AtomicStore.update}.
 */
export function tryClaim(store, key, expires) {
    if (store.tryClaim)
        return store.tryClaim(key, expires);
    return store.update(key, (current) => {
        if (current !== null && (!isReplayMarker(current) || current.expires > Date.now()))
            return { op: 'noop', result: false };
        return {
            op: 'set',
            value: { expires, type: 'mppx:replay' },
            result: true,
        };
    });
}
function isReplayMarker(value) {
    return (typeof value === 'object' &&
        value !== null &&
        'expires' in value &&
        typeof value.expires === 'number' &&
        'type' in value &&
        value.type === 'mppx:replay');
}
const keyPrefixCache = new WeakMap();
export function from(store, options) {
    return withKeyPrefix(store, options?.keyPrefix);
}
function withKeyPrefix(store, keyPrefix = '') {
    if (!keyPrefix)
        return store;
    const cached = keyPrefixCache.get(store)?.get(keyPrefix);
    if (cached)
        return cached;
    const backing = store;
    const prefixedKey = (key) => `${keyPrefix}${key}`;
    const prefixed = from({
        async get(key) {
            return backing.get(prefixedKey(key));
        },
        async put(key, value) {
            await backing.put(prefixedKey(key), value);
        },
        async delete(key) {
            await backing.delete(prefixedKey(key));
        },
        ...('update' in store
            ? {
                async update(key, fn) {
                    return store.update(prefixedKey(key), fn);
                },
            }
            : {}),
        ...('tryClaim' in store && typeof store.tryClaim === 'function'
            ? {
                tryClaim(key, expires) {
                    return store.tryClaim(prefixedKey(key), expires);
                },
            }
            : {}),
    });
    const cachedByPrefix = keyPrefixCache.get(store) ?? new Map();
    cachedByPrefix.set(keyPrefix, prefixed);
    keyPrefixCache.set(store, cachedByPrefix);
    return prefixed;
}
function wrapJsonUpdate(update) {
    if (!update)
        return {};
    return {
        async update(key, fn) {
            return update(key, (current) => {
                const parsed = current == null ? null : Json.parse(current);
                const change = fn(parsed);
                if (change.op !== 'set')
                    return change;
                return { ...change, value: Json.stringify(change.value) };
            });
        },
    };
}
export function cloudflare(kv, options) {
    return from({
        async get(key) {
            const raw = await kv.get(key);
            if (raw == null)
                return null;
            return Json.parse(raw);
        },
        async put(key, value) {
            await kv.put(key, Json.stringify(value));
        },
        async delete(key) {
            await kv.delete(key);
        },
        ...wrapJsonUpdate(kv.update),
    }, options);
}
/** In-memory store backed by a `Map`. JSON-roundtrips values to match production behavior. */
export function memory(options) {
    const store = new Map();
    return from({
        async get(key) {
            const raw = store.get(key);
            if (raw === undefined)
                return null;
            return Json.parse(raw);
        },
        async put(key, value) {
            store.set(key, Json.stringify(value));
        },
        async delete(key) {
            store.delete(key);
        },
        async update(key, fn) {
            const current = store.has(key) ? Json.parse(store.get(key)) : null;
            const change = fn(current);
            if (change.op === 'set')
                store.set(key, Json.stringify(change.value));
            if (change.op === 'delete')
                store.delete(key);
            return change.result;
        },
        tryClaim(key, expires) {
            const current = store.has(key) ? Json.parse(store.get(key)) : null;
            if (current !== null && (!isReplayMarker(current) || current.expires > Date.now()))
                return false;
            store.set(key, Json.stringify({ expires, type: 'mppx:replay' }));
            return true;
        },
    }, options);
}
export function redis(client, options) {
    return from({
        async get(key) {
            const raw = await client.get(key);
            if (raw == null)
                return null;
            return Json.parse(raw);
        },
        async put(key, value) {
            await client.set(key, Json.stringify(value));
        },
        async delete(key) {
            await client.del(key);
        },
        ...wrapJsonUpdate(client.update),
    }, options);
}
export function upstash(redis, options) {
    return from({
        async get(key) {
            return (await redis.get(key));
        },
        async put(key, value) {
            await redis.set(key, value);
        },
        async delete(key) {
            await redis.del(key);
        },
        ...(redis.update
            ? {
                update: redis.update,
            }
            : {}),
    }, options);
}
//# sourceMappingURL=Store.js.map