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
    return guardStore({
        get,
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
//# sourceMappingURL=local-storage.js.map