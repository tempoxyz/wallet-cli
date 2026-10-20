import type { CrossChainFunder, CrossChainFunderOptions } from '../interfaces/cross-chain.js';
import type * as Errors from './Errors.js';
export type { CrossChainFunder, EnsureBalanceOptions } from '../interfaces/cross-chain.js';
/**
 * Creates a funder that bridges from `from` to `to` through `routes`, recording each operation in
 * `operations` so a crash can be reconciled.
 */
export declare const create: (options: create.Options) => CrossChainFunder;
export declare namespace create {
    /** Options for {@link create}. */
    type Options = CrossChainFunderOptions;
    /** Errors {@link create} can throw while validating options. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
