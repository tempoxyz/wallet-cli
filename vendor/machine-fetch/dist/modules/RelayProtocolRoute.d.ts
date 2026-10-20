/**
 * A cross-chain route through Relay Protocol.
 * @module
 */
import type { BoundedCrossChainQuote, CrossChainRoute } from '../interfaces/cross-chain.js';
import { type RelayProtocolRouteOptions } from '../routes/relay-protocol.js';
import type * as Errors from './Errors.js';
export type { RelayApiQuote as ApiQuote, RelayProtocolLimits as Limits, } from '../routes/relay-protocol.js';
/** Creates a bounded cross-chain route that quotes, submits, and tracks Relay Protocol requests. */
export declare const create: (options: create.Options) => CrossChainRoute<BoundedCrossChainQuote>;
export declare namespace create {
    /** Options for {@link create}. */
    type Options = RelayProtocolRouteOptions;
    /** Errors {@link create} can throw while validating options. */
    type ErrorType = Errors.InvalidConfigurationErrorType | Errors.GlobalErrorType;
}
