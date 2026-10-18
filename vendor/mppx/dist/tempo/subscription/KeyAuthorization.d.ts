import { Hex } from 'ox';
import { KeyAuthorization } from 'ox/tempo';
import { type Address } from 'viem';
import type * as Methods from '../Methods.js';
import type { SubscriptionAccessKey, SubscriptionCredentialPayload, SubscriptionPeriodUnit } from './Types.js';
/** 4-byte selector for TIP-20 `transfer(address,uint256)`. */
export declare const transferSelector = "0xa9059cbb";
/** 4-byte selector for TIP-20 `transferWithMemo(address,uint256,bytes32)`. */
export declare const transferWithMemoSelector = "0x95777d59";
type SubscriptionRequest = ReturnType<typeof Methods.subscription.schema.request.parse>;
/**
 * Converts a subscription expiry timestamp into the Unix seconds value required by Tempo key
 * authorizations.
 */
export declare function toSubscriptionExpiryDate(subscriptionExpires: string | Date): Date;
export declare function toSubscriptionExpirySeconds(subscriptionExpires: Date): number;
/**
 * Converts the shared subscription period fields into the numeric period accepted by Tempo key
 * authorizations.
 */
export declare function toSubscriptionPeriodSeconds(request: {
    periodCount: string;
    periodUnit: SubscriptionPeriodUnit;
}): number;
/**
 * Verifies that the subscription duration is representable and lasts beyond the payment challenge.
 */
export declare function assertSubscriptionTiming(parameters: {
    challengeExpires?: string | undefined;
    request: Pick<SubscriptionRequest, 'periodCount' | 'periodUnit' | 'subscriptionExpires'>;
}): void;
/** Builds the Tempo access-key call scopes required for a subscription payment. */
export declare function getSubscriptionScopes(request: Pick<SubscriptionRequest, 'currency' | 'recipient'>): readonly [{
    readonly address: `0x${string}`;
    readonly selector: "0x95777d59";
    readonly recipients: readonly [`0x${string}`];
}];
/** Builds the RPC `allowedCalls` payload passed to `wallet_authorizeAccessKey`. */
export declare function getSubscriptionRpcAllowedCalls(request: Pick<SubscriptionRequest, 'currency' | 'recipient'>): readonly [{
    readonly target: `0x${string}`;
    readonly selectorRules: readonly [{
        readonly selector: "0x95777d59";
        readonly recipients: readonly [`0x${string}`];
    }];
}];
/** Decodes the server-issued challenge identifier for use as a signed Tempo witness. */
export declare function getSubscriptionChallengeWitness(challengeId: string): Hex.Hex;
/**
 * Creates and signs a Tempo key authorization for subscription payments when the account can sign
 * arbitrary hashes locally.
 */
export declare function signSubscriptionKeyAuthorization(parameters: {
    accessKey: SubscriptionAccessKey;
    account: {
        sign?: ((parameters: {
            hash: `0x${string}`;
        }) => Promise<`0x${string}`>) | undefined;
    };
    challengeId: string;
    chainId: number;
    request: Pick<SubscriptionRequest, 'amount' | 'currency' | 'periodCount' | 'periodUnit' | 'recipient' | 'subscriptionExpires'>;
}): Promise<{
    signature: {
        prehash: boolean;
        publicKey: {
            prefix: number;
            x: bigint;
            y: bigint;
        };
        signature: {
            r: bigint;
            s: bigint;
            yParity?: number | undefined;
        };
        type: 'p256';
        account?: undefined;
        config?: undefined;
        inner?: undefined;
        keyId?: undefined;
        metadata?: undefined;
        signatures?: undefined;
        userAddress?: undefined;
        version?: undefined;
    } | {
        signature: {
            r: bigint;
            s: bigint;
            yParity: number;
        };
        type: 'secp256k1';
        account?: undefined;
        config?: undefined;
        inner?: undefined;
        keyId?: undefined;
        metadata?: undefined;
        prehash?: undefined;
        publicKey?: undefined;
        signatures?: undefined;
        userAddress?: undefined;
        version?: undefined;
    } | {
        metadata: {
            authenticatorData: Hex.Hex;
            clientDataJSON: string;
        };
        publicKey: {
            prefix: number;
            x: bigint;
            y: bigint;
        };
        signature: {
            r: bigint;
            s: bigint;
            yParity?: number | undefined;
        };
        type: 'webAuthn';
        account?: undefined;
        config?: undefined;
        inner?: undefined;
        keyId?: undefined;
        prehash?: undefined;
        signatures?: undefined;
        userAddress?: undefined;
        version?: undefined;
    } | {
        account: import("ox/Address").Address;
        config: {
            owners: readonly {
                owner: import("ox/Address").Address;
                weight: number;
            }[];
            salt: Hex.Hex;
            threshold: number;
            version: bigint;
        };
        signatures: readonly ({
            prehash: boolean;
            publicKey: {
                prefix: number;
                x: bigint;
                y: bigint;
            };
            signature: {
                r: bigint;
                s: bigint;
                yParity?: number | undefined;
            };
            type: 'p256';
            metadata?: undefined;
        } | {
            signature: {
                r: bigint;
                s: bigint;
                yParity: number;
            };
            type: 'secp256k1';
            metadata?: undefined;
            prehash?: undefined;
            publicKey?: undefined;
        } | {
            metadata: {
                authenticatorData: Hex.Hex;
                clientDataJSON: string;
            };
            publicKey: {
                prefix: number;
                x: bigint;
                y: bigint;
            };
            signature: {
                r: bigint;
                s: bigint;
                yParity?: number | undefined;
            };
            type: 'webAuthn';
            prehash?: undefined;
        })[];
        type: 'multisig';
        inner?: undefined;
        keyId?: undefined;
        metadata?: undefined;
        prehash?: undefined;
        publicKey?: undefined;
        signature?: undefined;
        userAddress?: undefined;
        version?: undefined;
    };
    readonly address: `0x${string}`;
    readonly chainId: bigint;
    readonly expiry: number;
    readonly limits: readonly {
        readonly token: `0x${string}`;
        readonly limit: bigint;
        readonly period: number;
    }[];
    readonly scopes: readonly {
        readonly address: `0x${string}`;
        readonly selector: "0x95777d59";
        readonly recipients: readonly `0x${string}`[];
    }[];
    readonly type: "p256" | "secp256k1" | "webAuthn";
    readonly witness: `0x${string}`;
} | undefined>;
/**
 * Verifies that a subscription credential contains a key authorization scoped to the requested
 * token, recipient, amount, period, expiry, chain, and server-issued access key.
 */
export declare function verifySubscriptionKeyAuthorization(parameters: {
    accessKey?: SubscriptionAccessKey | undefined;
    challengeId: string;
    chainId: number;
    payload: SubscriptionCredentialPayload;
    request: SubscriptionRequest;
}): {
    authorization: KeyAuthorization.KeyAuthorization<boolean, bigint, number, `0x${string}`>;
    source: {
        address: Address;
        chainId: number;
    };
};
export {};
//# sourceMappingURL=KeyAuthorization.d.ts.map