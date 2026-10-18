import { type Address } from 'viem';
import type { Funder } from '../interfaces/funder.js';
/** A TIP-20 token and its reference currency. */
export type TempoToken = Readonly<{
    address: Address;
    /** Reference currency reported by the token, such as USD or EUR. */
    currency: string;
}>;
/** Mppx Tempo charge context that {@link tempoDex} supplies for each payment. */
export type TempoDexContext = Readonly<{
    /**
     * `false` disables auto-swap for the payment. Otherwise Mppx tries `tokenIn` in order, then its
     * own pathUSD and USDC defaults, with `slippage` in percent.
     */
    autoSwap: false | Readonly<{
        tokenIn: readonly Address[];
        slippage: number;
    }>;
}>;
/** Options for Mppx's canonical Tempo stablecoin DEX route. */
export type TempoDexOptions = Readonly<{
    /** Tempo chain ID; set explicitly for testnet or local Tempo nodes. Defaults to mainnet. */
    chainId?: number;
    /**
     * Funding tokens to try first, in order; defaults to canonical pathUSD then USDC. Mppx 0.12
     * appends pathUSD and USDC to every swap list, so this sets priority and is not an allowlist.
     * Inputs that are the requested token, or in another currency under `sameCurrencyOnly`, are
     * skipped; when none remains, auto-swap is disabled for that payment. A bare address is a USD
     * token; pass `{ address, currency }` for any other currency.
     */
    preferredInputs?: readonly (Address | TempoToken)[];
    /**
     * Requested tokens eligible for automatic acquisition, in the same form as `preferredInputs`;
     * defaults to canonical pathUSD and USDC.
     */
    outputs?: readonly (Address | TempoToken)[];
}>;
/**
 * Uses Mppx's atomic canonical Tempo stablecoin DEX path.
 *
 * Slippage comes from machine-fetch `maxSlippageBps`; method-level Mppx auto-swap configuration is
 * unnecessary because the funder supplies credential context immediately before signing. With
 * `sameCurrencyOnly`, only inputs in the requested token's currency are offered to the swap, and
 * swaps into a non-USD token are disabled because Mppx's appended inputs are USD. It does not
 * enforce `maxFundingSpend`, so payment funding rejects that policy before calling it.
 */
export declare function tempoDex(options?: TempoDexOptions): Funder<TempoDexContext>;
//# sourceMappingURL=tempo.d.ts.map