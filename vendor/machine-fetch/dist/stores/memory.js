import { checkReference, checkRelease, guardStore } from './serialization.js';
/** Creates isolated process-local state for tests and demos; it does not survive a restart. */
export function memoryStore() {
    const operations = new Map();
    return guardStore({
        get(id) {
            return structuredClone(operations.get(id));
        },
        list() {
            return [...operations.values()].map((operation) => structuredClone(operation));
        },
        claim(operation) {
            if (operations.has(operation.id))
                return false;
            operations.set(operation.id, structuredClone(operation));
            return true;
        },
        setReference(id, reference) {
            const operation = operations.get(id);
            checkReference(operation, reference);
            operations.set(id, { ...operation, reference });
        },
        release(id) {
            checkRelease(operations.get(id));
            operations.delete(id);
        },
    });
}
