import type { Token } from 'viem/tokens';
/** An explicit token address or a chain-indexed token definition. */
export type Currency = string | Token;
/** Resolves ordered USD offers without expanding acceptance from a live registry. */
export declare function resolve(parameters: {
    chainId?: number | undefined;
    testnet?: boolean | undefined;
    currencies?: readonly Currency[] | undefined;
    decimals?: number | undefined;
}): [({
    currency: string;
    decimals: number;
    chainId: number;
}[])[number], ...{
    currency: string;
    decimals: number;
    chainId: number;
}[]];
//# sourceMappingURL=currencies.d.ts.map