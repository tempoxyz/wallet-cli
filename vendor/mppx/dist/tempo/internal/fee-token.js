import { Actions, TokenId } from 'viem/tempo';
import * as TempoAddress from './address.js';
import * as defaults from './defaults.js';
function pushUnique(tokens, token, allowedTokens) {
    if (!token)
        return;
    if (allowedTokens &&
        !allowedTokens.some((allowedToken) => TempoAddress.isEqual(allowedToken, token)))
        return;
    if (tokens.some((t) => TempoAddress.isEqual(t, token)))
        return;
    tokens.push(token);
}
async function hasBalance(client, account, token) {
    try {
        return (await Actions.token.getBalance(client, { account, token })).amount > 0n;
    }
    catch {
        return false;
    }
}
function getChainFeeToken(client) {
    const feeToken = client.chain
        ?.feeToken;
    if (feeToken)
        return TokenId.toAddress(feeToken);
    const chainId = client.chain?.id;
    return chainId ? defaults.currency[chainId] : undefined;
}
/** Returns the stablecoins mppx supports for Tempo transaction fees. */
export function defaultFeeTokens(chainId) {
    const tokens = [];
    pushUnique(tokens, defaults.tokens.pathUsd);
    pushUnique(tokens, defaults.currency[chainId]);
    return tokens;
}
/**
 * Resolves a funded fee token from account, chain, and caller-supplied preferences.
 *
 * `prioritizeCandidates` checks candidate tokens before account and chain
 * preferences. `allowedTokens` limits every preference to the caller's policy.
 */
export async function resolveFeeToken(parameters) {
    const { account, allowedTokens, candidateTokens, client, prioritizeCandidates } = parameters;
    const tokens = [];
    if (prioritizeCandidates)
        for (const token of candidateTokens ?? [])
            pushUnique(tokens, token, allowedTokens);
    const userToken = await Actions.fee
        .getUserToken(client, { account })
        .then((token) => token?.address)
        .catch(() => undefined);
    pushUnique(tokens, userToken, allowedTokens);
    pushUnique(tokens, getChainFeeToken(client), allowedTokens);
    if (!prioritizeCandidates)
        for (const token of candidateTokens ?? [])
            pushUnique(tokens, token, allowedTokens);
    for (const token of tokens) {
        if (await hasBalance(client, account, token))
            return token;
    }
    return tokens[0];
}
//# sourceMappingURL=fee-token.js.map