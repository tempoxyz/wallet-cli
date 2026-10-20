import { OperationStoreError } from '../core/errors.js';
import { checkReference, checkRelease, deserialize, guardStore, serialize, } from './serialization.js';
/** Persists browser operations across reloads using localStorage and exclusive Web Locks. */
export function localStorageStore(options = {}) {
    const storage = options.storage ?? globalThis.localStorage;
    const locks = options.locks ?? globalThis.navigator?.locks;
    if (!storage || !locks)
        throw new OperationStoreError('localStorage and Web Locks are required');
    const prefix = options.prefix ?? 'machine-fetch:operations';
    const key = (id) => JSON.stringify([prefix, id]);
    const get = (id) => {
        const value = storage.getItem(key(id));
        return value === null ? undefined : deserialize(value, id);
    };
    /** The ID candidate in a storage key; only keys that `key` reproduces exactly belong here. */
    const candidateId = (storageKey) => {
        try {
            return JSON.parse(String(storageKey))[1];
        }
        catch {
            // Not JSON, so not a key this store wrote; the result is undefined and the key is skipped.
        }
    };
    return guardStore({
        get,
        list() {
            const operations = [];
            for (let index = 0; index < storage.length; index++) {
                const storageKey = storage.key(index);
                const id = candidateId(storageKey);
                if (typeof id !== 'string' || key(id) !== storageKey)
                    continue;
                // Another tab may remove an operation while this one enumerates.
                const operation = get(id);
                if (operation)
                    operations.push(operation);
            }
            return operations;
        },
        claim(operation) {
            // Snapshot before waiting for another tab's lock.
            const value = serialize(operation);
            const id = operation.id;
            return locks.request(key(id), () => {
                if (storage.getItem(key(id)) !== null)
                    return false;
                storage.setItem(key(id), value);
                return true;
            });
        },
        setReference(id, reference) {
            return locks.request(key(id), () => {
                const operation = get(id);
                checkReference(operation, reference);
                storage.setItem(key(id), serialize({ ...operation, reference }));
            });
        },
        release(id) {
            return locks.request(key(id), () => {
                checkRelease(get(id));
                storage.removeItem(key(id));
            });
        },
    });
}
