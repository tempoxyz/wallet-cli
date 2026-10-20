/**
 * A browser operation store backed by `localStorage`, with Web Locks coordinating tabs.
 * @module
 */
import type { CrossChainOperationStore } from '../interfaces/cross-chain.js';
import { type LocalStorageStoreOptions } from '../stores/local-storage.js';
import type * as Errors from './Errors.js';
/** Creates an operation store in browser storage. Site-data clearing erases its records. */
export declare const create: (options?: create.Options) => CrossChainOperationStore;
export declare namespace create {
    /** Options for {@link create}. */
    type Options = LocalStorageStoreOptions;
    /** Errors {@link create} can throw. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.OperationStoreErrorType | Errors.GlobalErrorType;
}
