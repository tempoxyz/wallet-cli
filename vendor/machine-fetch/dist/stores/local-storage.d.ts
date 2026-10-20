import type { CrossChainOperationStore } from '../interfaces/cross-chain.js';
/** Browser storage and same-origin locks; use the same prefix in every tab sharing operations. */
export type LocalStorageStoreOptions = Readonly<{
    /** Namespace within localStorage. @default machine-fetch:operations */
    prefix?: string | undefined;
    /** Storage to write; `key` and `length` enumerate operations for `list`. @default globalThis.localStorage */
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | undefined;
    /** Lock manager for atomic cross-tab claims. @default navigator.locks */
    locks?: Pick<LockManager, 'request'> | undefined;
}>;
/** Persists browser operations across reloads using localStorage and exclusive Web Locks. */
export declare function localStorageStore(options?: LocalStorageStoreOptions): CrossChainOperationStore;
