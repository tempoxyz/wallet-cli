import { getAddress } from 'viem';
import { InvalidConfigurationError } from '../core/errors.js';
import { isEvmAddress, isTokenDecimals } from '../core/validate.js';
const decimal = /^(\d+)(?:\.(\d+))?$/;
/** Bounds human-readable input before decimal expansion, as policy does. */
const maxDecimalLength = 1_024;
/** The token's checksummed address and CAIP-2 network on one chain. */
function onChain(token, chainId) {
    if (!Number.isSafeInteger(chainId) || chainId <= 0)
        throw new InvalidConfigurationError('chainId must be a positive safe integer');
    if (!isTokenDecimals(token.decimals))
        throw new InvalidConfigurationError('Token decimals must be an integer from 0 to 255');
    const address = token.addresses[chainId];
    if (typeof address !== 'string' || !isEvmAddress(address))
        throw new InvalidConfigurationError(`Token has no address on chain ${chainId}`);
    return { asset: getAddress(address), network: `eip155:${chainId}` };
}
/** Implements `Evm.amount`. */
export function evmAmount(parameters) {
    const { token, chainId, amount } = parameters;
    const { asset, network } = onChain(token, chainId);
    // Check the type first: a bigint such as 100_000n would coerce to '100000' whole tokens.
    const match = typeof amount !== 'string' || amount.length > maxDecimalLength ? null : decimal.exec(amount);
    if (!match)
        throw new InvalidConfigurationError('amount must be a non-negative decimal string');
    const fraction = match[2] ?? '';
    if (fraction.length > token.decimals)
        throw new InvalidConfigurationError('amount has more decimal places than the token');
    return Object.freeze({
        network,
        asset,
        amount: BigInt(`${match[1]}${fraction.padEnd(token.decimals, '0')}`),
    });
}
/** Implements `Evm.tokenAccount`. */
export function evmTokenAccount(parameters) {
    const { token, chainId, owner } = parameters;
    if (typeof owner !== 'string' || !isEvmAddress(owner))
        throw new InvalidConfigurationError('Owner must be an EVM address');
    if (typeof token.currency !== 'string' || !token.currency.trim())
        throw new InvalidConfigurationError('Token currency is required');
    const { asset, network } = onChain(token, chainId);
    return Object.freeze({
        owner: getAddress(owner),
        asset,
        chainId,
        currency: token.currency,
        decimals: token.decimals,
        network,
    });
}
