import type { Address, Hex } from 'viem';
/** EIP-712 primary type for Tempo proof credentials. */
export declare const primaryType: "Proof";
/**
 * EIP-712 typed-data field definitions for Tempo zero-amount proof credentials.
 *
 * The `account` field cryptographically binds the signature to the payer
 * wallet, so a proof signed for one account cannot be replayed against another.
 */
export declare const types: {
    readonly Proof: readonly [{
        readonly name: 'account';
        readonly type: 'address';
    }, {
        readonly name: 'challengeId';
        readonly type: 'string';
    }, {
        readonly name: 'realm';
        readonly type: 'string';
    }];
};
/** Constructs the EIP-712 domain for a Tempo proof credential. */
export declare function domain(chainId: number): {
    readonly name: 'MPP';
    readonly version: '3';
    readonly chainId: number;
};
/**
 * Constructs the EIP-712 message for a Tempo proof credential.
 *
 * @param parameters - Proof message parameters.
 * @param parameters.account - Payer wallet address the proof is bound to.
 * @param parameters.challengeId - Challenge `id` being proven.
 * @param parameters.realm - Challenge `realm` being proven.
 */
export declare function message(parameters: {
    account: Address;
    challengeId: string;
    realm: string;
}): {
    readonly account: `0x${string}`;
    readonly challengeId: string;
    readonly realm: string;
};
/**
 * Constructs the complete EIP-712 typed-data payload for a Tempo proof
 * credential — the canonical, wallet-bound proof contract.
 */
export declare function typedData(parameters: {
    account: Address;
    chainId: number;
    challengeId: string;
    realm: string;
}): {
    readonly domain: {
        readonly name: 'MPP';
        readonly version: '3';
        readonly chainId: number;
    };
    readonly types: {
        readonly Proof: readonly [{
            readonly name: 'account';
            readonly type: 'address';
        }, {
            readonly name: 'challengeId';
            readonly type: 'string';
        }, {
            readonly name: 'realm';
            readonly type: 'string';
        }];
    };
    readonly primaryType: "Proof";
    readonly message: {
        readonly account: `0x${string}`;
        readonly challengeId: string;
        readonly realm: string;
    };
};
/** Computes the EIP-712 digest (signing payload) for a Tempo proof credential. */
export declare function hash(parameters: {
    account: Address;
    chainId: number;
    challengeId: string;
    realm: string;
}): Hex;
/** Constructs the canonical `did:pkh:eip155` source DID for Tempo proof credentials. */
export declare function proofSource(parameters: {
    address: string;
    chainId: number;
}): string;
/** Parses a Tempo `did:pkh:eip155` source DID into its chain ID and wallet address. */
export declare function parsePkhSource(source: string): {
    address: Address;
    chainId: number;
} | null;
/** Parses a Tempo proof credential source DID into its chain ID and wallet address. */
export declare function parseProofSource(source: string): {
    address: Address;
    chainId: number;
} | null;
//# sourceMappingURL=Proof.d.ts.map