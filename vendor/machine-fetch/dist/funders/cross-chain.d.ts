import type { CrossChainFunder, CrossChainFundOptions } from '../interfaces/cross-chain.js';
/**
 * Creates a funder that obtains an exact payment shortfall through trusted cross-chain routes.
 * Payment funding uses the request's attempt ID as its durable operation ID.
 */
export declare function crossChainFund(options: CrossChainFundOptions): CrossChainFunder;
//# sourceMappingURL=cross-chain.d.ts.map