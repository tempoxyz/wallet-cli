import { getAddress } from 'viem';
import { pathusd, usdce } from 'viem/tokens';
import { InvalidConfigurationError } from '../core/errors.js';
import { assetKey, isEvmAddress, isEvmNetwork, isRecord, isTokenDecimals, } from '../core/validate.js';
/** Tokens trusted and swapped from on every Tempo chain Viem lists them for. */
const defaultTokens = [pathusd, usdce];
/** Currency of the inputs Mppx appends to every auto-swap list (pathUSD and USDC). */
const mppxDefaultInputCurrency = 'USD';
/** Context that stops Mppx from swapping, whatever the method's own auto-swap setting. */
export const autoSwapDisabled = Object.freeze({
    context: Object.freeze({ autoSwap: false }),
});
/**
 * The funder every Mppx entry point adds after the configured ones. It trusts metadata only for
 * known tokens, and supplies auto-swap context from machine-fetch policy immediately before
 * signing, so policy overrides the method's own auto-swap setting.
 */
export function tempoFunder(autoSwap = true) {
    if (typeof autoSwap !== 'boolean' && !isRecord(autoSwap))
        throw new InvalidConfigurationError('autoSwap must be a boolean or an options object');
    // A boolean has no `tokens`, so this reads the configured tokens or undefined.
    const configured = autoSwap.tokens;
    if (configured !== undefined && !Array.isArray(configured))
        throw new InvalidConfigurationError('autoSwap tokens must be an array');
    const known = trustedTokens([...(configured ?? []), ...defaultTokens]);
    const find = (network, asset) => known.get(assetKey({ network, asset }));
    return Object.freeze({
        name: 'tempo',
        // A swap that does not run spends nothing, and it never runs while `maxFundingSpend` is set.
        enforcesFundingSpend: true,
        resolve(requirement) {
            const token = find(requirement.network, requirement.asset);
            if (requirement.protocol !== 'mpp' || requirement.method !== 'tempo' || !token)
                return undefined;
            return Object.freeze({
                ...requirement,
                asset: token.address,
                currency: token.currency,
                decimals: token.decimals,
            });
        },
        prepare(requirement, { policy, signal }) {
            signal.throwIfAborted();
            const requested = find(requirement.network, requirement.asset);
            const tokenIn = [...known.values()]
                .filter((token) => token.network === requested.network &&
                token.address !== requested.address &&
                (!policy.sameCurrencyOnly || token.currency === requested.currency))
                .map((token) => token.address);
            // Mppx appends its USD default inputs to any list and cannot cap a swap's input, so a swap
            // into another currency under `sameCurrencyOnly`, or under a `maxFundingSpend` ceiling, cannot
            // be enforced. Disable swapping then, and when nothing is eligible: payment uses the existing
            // balance, and Mppx rejects a shortfall.
            if (autoSwap === false ||
                policy.maxFundingSpend !== undefined ||
                tokenIn.length === 0 ||
                (policy.sameCurrencyOnly && requested.currency !== mppxDefaultInputCurrency))
                return autoSwapDisabled;
            return Object.freeze({
                context: Object.freeze({
                    autoSwap: Object.freeze({
                        tokenIn: Object.freeze(tokenIn),
                        slippage: policy.maxSlippageBps / 100,
                    }),
                }),
            });
        },
    });
}
/** Trusted tokens keyed by network and address, in priority order; earlier tokens win. */
function trustedTokens(tokens) {
    const trusted = new Map();
    for (const token of tokens) {
        // Viem tokens are callable, so check the fields rather than the token's type.
        if (!isRecord(token?.addresses))
            throw new InvalidConfigurationError('autoSwap tokens must be Viem tokens');
        const { currency, decimals } = token;
        if (typeof currency !== 'string' || !currency.trim())
            throw new InvalidConfigurationError('autoSwap tokens must declare a currency');
        if (!isTokenDecimals(decimals))
            throw new InvalidConfigurationError('autoSwap token decimals must be an integer from 0 to 255');
        for (const [chainId, address] of Object.entries(token.addresses)) {
            const network = `eip155:${chainId}`;
            if (!isEvmNetwork(network) || !Number.isSafeInteger(Number(chainId)))
                throw new InvalidConfigurationError('autoSwap token chain IDs must be positive safe integers');
            if (!isEvmAddress(address))
                throw new InvalidConfigurationError('autoSwap token addresses must be EVM addresses');
            const entry = Object.freeze({
                network,
                address: getAddress(address),
                currency: currency.toUpperCase(),
                decimals,
            });
            const key = assetKey({ network, asset: entry.address });
            if (!trusted.has(key))
                trusted.set(key, entry);
        }
    }
    return trusted;
}
