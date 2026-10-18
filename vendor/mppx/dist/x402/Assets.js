import { getAddress } from 'viem';
const knownAsset = Symbol('mppx.x402.asset');
/** Creates typed x402 asset metadata for custom tokens. */
export function define(parameters) {
    return {
        [knownAsset]: true,
        address: parameters.address,
        decimals: parameters.decimals,
        network: parameters.network,
        transfer: parameters.transfer,
    };
}
/** Creates x402 asset metadata from a `viem/tokens` token definition. */
export function fromToken(token, parameters) {
    const resolved = token(parameters.chainId);
    return define({
        address: resolved.address,
        decimals: resolved.decimals,
        network: toNetwork(parameters.chainId),
        transfer: withTokenDefaults(parameters.transfer, resolved),
    });
}
/** Base network known assets. */
export const base = {
    USDC: define({
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
        network: 'eip155:8453',
        transfer: {
            // USDC's EIP-712 domain name differs between Base and Base Sepolia.
            name: 'USD Coin',
            type: 'eip3009',
            version: '2',
        },
    }),
};
/** Base Sepolia known assets. */
export const baseSepolia = {
    USDC: define({
        address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        decimals: 6,
        network: 'eip155:84532',
        transfer: {
            // Base Sepolia test USDC signs with the shorter EIP-712 domain name.
            name: 'USDC',
            type: 'eip3009',
            version: '2',
        },
    }),
};
/** Celo network known assets. */
export const celo = {
    USDC: define({
        address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
        decimals: 6,
        network: 'eip155:42220',
        transfer: {
            // Celo USDC signs with the shorter EIP-712 domain name.
            name: 'USDC',
            type: 'eip3009',
            version: '2',
        },
    }),
    USDT: define({
        address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
        decimals: 6,
        network: 'eip155:42220',
        transfer: {
            // Celo USDT signs with domain version "1", unlike Circle's FiatToken "2".
            name: 'Tether USD',
            type: 'eip3009',
            version: '1',
        },
    }),
};
/** Celo Sepolia known assets. */
export const celoSepolia = {
    USDC: define({
        address: '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
        decimals: 6,
        network: 'eip155:11142220',
        transfer: {
            name: 'USDC',
            type: 'eip3009',
            version: '2',
        },
    }),
};
/** Returns true when a value is known x402 asset metadata. */
export function isAsset(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    return value[knownAsset] === true;
}
/** Returns true when a value is a `viem/tokens` token definition. */
export function isToken(value) {
    return (typeof value === 'function' &&
        typeof value.addresses === 'object' &&
        typeof value.decimals === 'number');
}
/** Returns true when a currency is a raw address without chain metadata. */
export function isRawAddress(currency) {
    return typeof currency === 'string';
}
/** Resolves currency metadata for an EVM network. */
export function resolve(currency, network) {
    if (isAsset(currency)) {
        if (currency.network !== network)
            return undefined;
        return {
            address: currency.address,
            decimals: currency.decimals,
            transfer: currency.transfer,
        };
    }
    if (isToken(currency)) {
        const address = currency.addresses[toChainId(network)];
        if (!address)
            return undefined;
        return {
            address,
            decimals: currency.decimals,
            name: currency.name,
        };
    }
    return {
        address: currency,
    };
}
/** Returns true when a currency resolves to the accepted address on the network. */
export function matches(currency, acceptedCurrency, network) {
    const resolved = resolve(currency, network);
    if (!resolved)
        return false;
    return getAddress(resolved.address) === getAddress(acceptedCurrency);
}
/** Converts an EVM chain ID to a CAIP-2 network identifier. */
export function toNetwork(chainId) {
    return `eip155:${chainId}`;
}
/** Converts a CAIP-2 EVM network identifier to a chain ID. */
export function toChainId(network) {
    return Number(network.slice('eip155:'.length));
}
function withTokenDefaults(transfer, token) {
    if (transfer.type !== 'eip3009')
        return transfer;
    if (transfer.name)
        return { ...transfer, name: transfer.name };
    if (!token.name)
        throw new Error('EIP-3009 token assets require a token name.');
    return {
        ...transfer,
        name: token.name,
    };
}
//# sourceMappingURL=Assets.js.map