import type { EvmFunderOptions } from '../interfaces/evm.js';
import type { Funder } from '../interfaces/funder.js';
import type * as Errors from './Errors.js';
/** Creates a funder that acquires the payment token on the same EVM chain through `routes`. */
export declare const create: (options: create.Options) => Funder;
export declare namespace create {
    /** Options for {@link create}. */
    type Options = EvmFunderOptions;
    /** Errors {@link create} can throw while validating options. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
