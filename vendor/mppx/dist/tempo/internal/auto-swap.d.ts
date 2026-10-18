import type { Address, Client } from 'viem';
/** Default fallback currencies for auto-swap, in priority order. */
export declare const defaultCurrencies: readonly Address[];
/**
 * Finds the optimal swap calls to acquire `amountOut` of `tokenOut`,
 * returning an approve + buy call sequence if a viable route is found.
 *
 * Returns `undefined` if the account already holds enough of `tokenOut`
 * or no viable swap route exists from the given input tokens.
 */
export declare function findCalls(client: Client, parameters: findCalls.Parameters): Promise<findCalls.ReturnType>;
export declare namespace findCalls {
    type Parameters = {
        /** Address of the account to check balances for. */
        account: Address;
        /** Amount of the target token needed. */
        amountOut: bigint;
        /** Candidate input tokens to swap from, in priority order. */
        tokenIn: readonly Address[];
        /** Max slippage tolerance as a percentage (e.g. `1` = 1%). */
        slippage: number;
        /** Address of the target token to acquire. */
        tokenOut: Address;
    };
    /** `undefined` when no swap is needed (account has sufficient balance). */
    type ReturnType = readonly object[] | undefined;
}
/** Resolves an auto-swap configuration value into concrete currencies and slippage. */
export declare function resolve(value: resolve.Value | undefined, defaultCurrencies: readonly Address[]): resolve.Resolved | false;
export declare namespace resolve {
    type Options = {
        /** Fallback tokens to try swapping from, in priority order. */
        tokenIn?: Address[] | undefined;
        /**
         * Whether to also try the default currencies after `tokenIn`. Set `false` to swap only from
         * `tokenIn`, as an allowlist. Ignored without `tokenIn`. @default true
         */
        fallback?: boolean | undefined;
        /** Max slippage tolerance as a percentage (e.g. `1` = 1%). @default 1 */
        slippage?: number | undefined;
    };
    type Value = boolean | Options;
    type Resolved = {
        tokenIn: readonly Address[];
        slippage: number;
    };
}
export declare class InsufficientFundsError extends Error {
    readonly name = "InsufficientFundsError";
    constructor({ currency }: {
        currency: Address;
    });
}
//# sourceMappingURL=auto-swap.d.ts.map