import type { EvmRoute } from '../interfaces/evm.js';
import type * as Errors from './Errors.js';
export type { EvmExecuteRequest as ExecuteRequest, EvmQuote as Quote, EvmQuoteRequest as QuoteRequest, EvmRoute, } from '../interfaces/evm.js';
/** Validates a route and returns a frozen copy, so later mutation cannot change trusted behavior. */
export declare const from: (route: EvmRoute) => EvmRoute;
export declare namespace from {
    /** Errors {@link from} can throw while validating the route. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
