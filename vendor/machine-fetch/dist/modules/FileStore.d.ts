/**
 * A Node operation store that keeps one file per operation on a local macOS or Linux filesystem.
 * @module
 */
import type { CrossChainOperationStore } from '../interfaces/cross-chain.js';
import type * as Errors from './Errors.js';
/** Creates an operation store in `directory`, which must not be shared with other data. */
export declare const create: (directory: string) => CrossChainOperationStore;
export declare namespace create {
    /** Errors {@link create} can throw. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.OperationStoreErrorType | Errors.GlobalErrorType;
}
