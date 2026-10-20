import type { CrossChainFunder, CrossChainFunderOptions } from '../interfaces/cross-chain.js';
/**
 * Creates a funder that obtains an exact payment shortfall through trusted cross-chain routes.
 * Payment funding uses the request's operation ID as its durable operation ID.
 */
export declare function crossChainFunder(options: CrossChainFunderOptions): CrossChainFunder;
