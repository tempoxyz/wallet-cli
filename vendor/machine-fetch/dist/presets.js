import { getAddress } from 'viem';
import { base, tempo } from 'viem/chains';
import { defineToken, ousd, usdc } from 'viem/tokens';
import { FundingError } from './core/errors.js';
import { isEvmAddress } from './core/validate.js';
const baseUsdcAddress = getAddress(usdc.addresses[base.id]);
const tempoOusdAddress = getAddress(ousd.addresses[tempo.id]);
/** Returns Base USDC metadata without enabling any route or provider. */
export function baseUsdcToken() {
    const token = defineToken({
        addresses: Object.freeze({ [base.id]: baseUsdcAddress }),
        currency: 'USD',
        decimals: 6,
        name: 'USD Coin',
        symbol: 'USDC',
    });
    // Viem tokens are callable; freezing in place keeps the call signature in the type.
    Object.freeze(token);
    return token;
}
/** Creates the canonical Tempo OUSD side of a relay operation. */
export function tempoOusd(account) {
    return Object.freeze({
        account: accountAddress(account),
        asset: tempoOusdAddress,
        chainId: tempo.id,
        currency: 'USD',
        decimals: 6,
        network: `eip155:${tempo.id}`,
    });
}
/** Creates the canonical Base USDC side of a relay operation. */
export function baseUsdc(account) {
    return Object.freeze({
        account: accountAddress(account),
        asset: baseUsdcAddress,
        chainId: base.id,
        currency: 'USD',
        decimals: 6,
        network: `eip155:${base.id}`,
    });
}
function accountAddress(account) {
    if (!isEvmAddress(account))
        throw new FundingError('Account must be an EVM address', { code: 'INVALID_CONFIGURATION' });
    return getAddress(account);
}
//# sourceMappingURL=presets.js.map