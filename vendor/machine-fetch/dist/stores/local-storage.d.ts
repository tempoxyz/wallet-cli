import type { CrossChainOperationStore } from '../interfaces/cross-chain.js';
/** Browser storage and same-origin locks; use the same prefix in every tab sharing operations. */
export type LocalStorageStoreOptions = Readonly<{
    /** Namespace within localStorage. @default machine-fetch:operations */
    prefix?: string;
    /** Defaults to globalThis.localStorage. */
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    /** Defaults to navigator.locks; required for atomic cross-tab claims. */
    locks?: Pick<LockManager, 'request'>;
}>;
/** Persists browser operations across reloads using localStorage and exclusive Web Locks. */
export declare function localStorageStore(options?: LocalStorageStoreOptions): CrossChainOperationStore;
//# sourceMappingURL=local-storage.d.ts.map