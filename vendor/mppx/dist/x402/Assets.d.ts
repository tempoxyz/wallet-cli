import type { Token } from 'viem/tokens';
import type { Asset, EvmNetwork, ExactTransfer } from './Types.js';
declare const knownAsset: unique symbol;
/** Known x402 asset metadata. */
export type KnownAsset = Asset & {
    readonly [knownAsset]: true;
    network: EvmNetwork;
};
/** Viem token metadata from `viem/tokens`. */
export type ViemToken = Token;
/** Currency metadata accepted by EVM and x402 payment config. */
export type Currency = `0x${string}` | KnownAsset | ViemToken;
/** Creates typed x402 asset metadata for custom tokens. */
export declare function define(parameters: define.Parameters): KnownAsset;
export declare namespace define {
    type Parameters = {
        address: `0x${string}`;
        decimals: number;
        network: EvmNetwork;
        transfer: ExactTransfer;
    };
}
/** Creates x402 asset metadata from a `viem/tokens` token definition. */
export declare function fromToken(token: ViemToken, parameters: fromToken.Parameters): KnownAsset;
export declare namespace fromToken {
    type Parameters = {
        chainId: number;
        transfer: Transfer;
    };
    type Transfer = (Omit<Extract<ExactTransfer, {
        type: 'eip3009';
    }>, 'name'> & {
        name?: string | undefined;
    }) | Extract<ExactTransfer, {
        type: 'permit2';
    }>;
}
/** Base network known assets. */
export declare const base: {
    readonly USDC: KnownAsset;
};
/** Base Sepolia known assets. */
export declare const baseSepolia: {
    readonly USDC: KnownAsset;
};
/** Celo network known assets. */
export declare const celo: {
    readonly USDC: KnownAsset;
    readonly USDT: KnownAsset;
};
/** Celo Sepolia known assets. */
export declare const celoSepolia: {
    readonly USDC: KnownAsset;
};
/** Returns true when a value is known x402 asset metadata. */
export declare function isAsset(value: unknown): value is KnownAsset;
/** Returns true when a value is a `viem/tokens` token definition. */
export declare function isToken(value: unknown): value is ViemToken;
/** Returns true when a currency is a raw address without chain metadata. */
export declare function isRawAddress(currency: Currency): currency is `0x${string}`;
/** Resolves currency metadata for an EVM network. */
export declare function resolve(currency: Currency, network: EvmNetwork): resolve.Result | undefined;
export declare namespace resolve {
    type Result = {
        address: `0x${string}`;
        decimals?: number | undefined;
        name?: string | undefined;
        transfer?: ExactTransfer | undefined;
    };
}
/** Returns true when a currency resolves to the accepted address on the network. */
export declare function matches(currency: Currency, acceptedCurrency: `0x${string}`, network: EvmNetwork): boolean;
/** Converts an EVM chain ID to a CAIP-2 network identifier. */
export declare function toNetwork(chainId: number): EvmNetwork;
/** Converts a CAIP-2 EVM network identifier to a chain ID. */
export declare function toChainId(network: EvmNetwork): number;
export {};
//# sourceMappingURL=Assets.d.ts.map