import type { Address, Client } from 'viem';
/** Returns the stablecoins mppx supports for Tempo transaction fees. */
export declare function defaultFeeTokens(chainId: number | undefined): Address[];
/**
 * Resolves a funded fee token from account, chain, and caller-supplied preferences.
 *
 * `prioritizeCandidates` checks candidate tokens before account and chain
 * preferences. `allowedTokens` limits every preference to the caller's policy.
 */
export declare function resolveFeeToken(parameters: {
    account: Address;
    allowedTokens?: readonly Address[] | undefined;
    candidateTokens?: readonly Address[] | undefined;
    client: Client;
    prioritizeCandidates?: boolean | undefined;
}): Promise<Address | undefined>;
//# sourceMappingURL=fee-token.d.ts.map