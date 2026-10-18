import type { EvmFundOptions, EvmRoute } from '../interfaces/evm.js';
import type { Funder } from '../interfaces/funder.js';
/** Validates a caller-owned route and returns a frozen snapshot of its route fields. */
export declare function evmRoute(route: EvmRoute): EvmRoute;
/**
 * Creates a funder that acquires exact EVM payment assets through caller-trusted routes. It does
 * not enforce `maxFundingSpend`, so payment funding rejects that policy before calling it.
 */
export declare function evmFund(options: EvmFundOptions): Funder;
//# sourceMappingURL=evm.d.ts.map