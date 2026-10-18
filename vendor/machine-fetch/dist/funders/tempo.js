import { getAddress } from 'viem';
import { tempo } from 'viem/chains';
import { FundingError } from '../core/errors.js';
import { assetKey, isEvmAddress } from '../core/validate.js';
const pathUsd = '0x20c0000000000000000000000000000000000000';
const tempoUsdc = '0x20C000000000000000000000b9537d11c60E8b50';
/** TIP-20 tokens always use six decimals. */
const tip20Decimals = 6;
/** Currency of the inputs Mppx 0.12 appends to every auto-swap list (pathUSD and USDC). */
const mppxDefaultInputCurrency = 'USD';
/**
 * Uses Mppx's atomic canonical Tempo stablecoin DEX path.
 *
 * Slippage comes from machine-fetch `maxSlippageBps`; method-level Mppx auto-swap configuration is
 * unnecessary because the funder supplies credential context immediately before signing. With
 * `sameCurrencyOnly`, only inputs in the requested token's currency are offered to the swap, and
 * swaps into a non-USD token are disabled because Mppx's appended inputs are USD. It does not
 * enforce `maxFundingSpend`, so payment funding rejects that policy before calling it.
 */
export function tempoDex(options = {}) {
    const chainId = options.chainId ?? tempo.id;
    if (!Number.isSafeInteger(chainId) || chainId <= 0)
        throw configuration('Tempo chain ID must be a positive safe integer');
    const inputs = tokens(options.preferredInputs);
    const outputs = tokens(options.outputs);
    const network = `eip155:${chainId}`;
    const output = (asset) => {
        const key = assetKey({ network, asset });
        return outputs.find((token) => assetKey({ network, asset: token.address }) === key);
    };
    return Object.freeze({
        name: 'tempo-dex',
        resolve(requirement) {
            const token = output(requirement.asset);
            if (requirement.protocol !== 'mpp' ||
                requirement.method !== 'tempo' ||
                requirement.network !== network ||
                !token)
                return undefined;
            return Object.freeze({
                ...requirement,
                asset: token.address,
                currency: token.currency,
                decimals: tip20Decimals,
            });
        },
        prepare(requirement, { policy, signal }) {
            signal.throwIfAborted();
            const requested = output(requirement.asset);
            const tokenIn = inputs
                .filter((token) => token.address !== requested?.address &&
                (!policy.sameCurrencyOnly || token.currency === requested?.currency))
                .map((token) => token.address);
            // Mppx appends its USD default inputs to any list, and falls back to them (or the method's own
            // auto-swap settings) for an empty one, so a same-currency swap into another currency cannot be
            // enforced. Explicitly disable swapping then, and when nothing is eligible. Payment then uses
            // the existing balance, and Mppx rejects a shortfall.
            if (tokenIn.length === 0 ||
                // Stryker disable next-line OptionalChaining: same-currency inputs imply a requested token
                (policy.sameCurrencyOnly && requested?.currency !== mppxDefaultInputCurrency))
                return Object.freeze({ context: Object.freeze({ autoSwap: false }) });
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
function tokens(configured) {
    return Object.freeze((configured ?? [pathUsd, tempoUsdc]).map(token));
}
function token(configured) {
    const { address, currency } = typeof configured === 'string' ? { address: configured, currency: 'USD' } : configured;
    if (!isEvmAddress(address))
        throw configuration('Tempo token address must be an EVM address');
    if (typeof currency !== 'string' || !currency.trim())
        throw configuration('Tempo token currency must be a non-empty string');
    return Object.freeze({ address: getAddress(address), currency: currency.toUpperCase() });
}
function configuration(message) {
    return new FundingError(message, { code: 'INVALID_CONFIGURATION' });
}
//# sourceMappingURL=tempo.js.map