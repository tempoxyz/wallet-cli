import type { ValueOf } from '../../internal/types.js';
export declare const chainId: {
    readonly mainnet: 4217;
    readonly testnet: 42431;
};
export type ChainId = ValueOf<typeof chainId>;
/** Token addresses. */
export declare const tokens: {
    /** OpenUSD (OUSD), deployed at the same address on Tempo mainnet and Moderato. */
    readonly ousd: "0x20c0000000000000000000006a37DA5C996874BE";
    /** USDC (USDC.e) token address. */
    readonly usdc: `0x${string}`;
    /** pathUSD token address. */
    readonly pathUsd: "0x20c0000000000000000000000000000000000000";
};
/** Chain ID → default currency. */
export declare const currency: {
    readonly 4217: `0x${string}`;
    readonly 42431: "0x20c0000000000000000000000000000000000000";
};
/** Immutable canonical first-party machine-token deployments used by charge routes. */
export declare const machineToken: Readonly<{
    readonly 4217: Readonly<{
        swap: "0xF72E5107c32C655ffA7539a3C8e97B7C3cE16A3F";
        token: "0x20c000000000000000000000f37de3740ADec032";
    }>;
    readonly 42431: Readonly<{
        swap: "0xd05f8EdFBB54Da0d765C9fE9b2B3f7d2E3a8C466";
        token: "0x20c000000000000000000000f37de3740ADec032";
    }>;
}>;
/**
 * Default token decimals for TIP-20 stablecoins (e.g. pathUSD, USDC).
 *
 * All TIP-20 tokens on Tempo use 6 decimals, so there is no risk of
 * client/server mismatch within the Tempo ecosystem. Other chains and
 * runtimes should set `decimals` explicitly to match their token.
 */
export declare const decimals = 6;
/** Default payment-channel escrow contract addresses per chain. */
export declare const escrowContract: {
    readonly 4217: '0x33b901018174DDabE4841042ab76ba85D4e24f25';
    readonly 42431: '0xe1c4d3dce17bc111181ddf716f75bae49e61a336';
};
/** Default RPC URLs for each Tempo chain. */
export declare const rpcUrl: {
    readonly 4217: 'https://rpc.tempo.xyz';
    readonly 42431: 'https://rpc.moderato.tempo.xyz';
};
/** Resolves the default currency. */
export declare function resolveCurrency(parameters: {
    /** Chain ID. */
    chainId?: number | undefined;
    /** Whether in testnet mode. */
    testnet?: boolean | undefined;
}): string;
//# sourceMappingURL=defaults.d.ts.map