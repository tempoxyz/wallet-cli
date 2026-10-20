/**
 * Routes that fund through Privy wallet actions.
 * @module
 */
import type { CrossChainRoute, EstimatedCrossChainQuote } from '../interfaces/cross-chain.js';
import type { EvmRoute } from '../interfaces/evm.js';
import { type PrivyRouteOptions } from '../routes/privy.js';
import type * as Errors from './Errors.js';
export type { PrivyClient as Client, PrivyRouteOptions as Options } from '../routes/privy.js';
/** Creates a same-chain swap route for `EvmFunder.create` through Privy wallet actions. */
export declare const evm: (options: PrivyRouteOptions) => EvmRoute;
export declare namespace evm {
    /** Errors {@link evm} can throw while validating options. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
/** Creates a cross-chain route for `CrossChainFunder.create` through Privy wallet actions. */
export declare const crossChain: (options: PrivyRouteOptions) => CrossChainRoute<EstimatedCrossChainQuote>;
export declare namespace crossChain {
    /** Errors {@link crossChain} can throw while validating options. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
