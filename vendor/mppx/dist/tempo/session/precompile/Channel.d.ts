import type { Account, Address, Hex } from 'viem';
import type { z_TransactionRequestTempo, z_TransactionSerializableTempo } from 'viem/tempo';
import type { ChannelDescriptor } from './Protocol.js';
/** Re-export of the TIP-1034 channel descriptor shape. */
export type { ChannelDescriptor } from './Protocol.js';
/** Resolves the descriptor's effective voucher signer; zero delegates to the payer. */
export declare function resolveAuthorizedSigner(descriptor: ChannelDescriptor): Address;
/** Tempo transaction shape used to derive the TIP-1034 `expiringNonceHash`. */
export type ExpiringNonceTransaction = (z_TransactionSerializableTempo | z_TransactionRequestTempo) & {
    /** Fee-payer metadata may be present on fee-sponsored open transactions. */
    feePayer?: Account | true | undefined;
};
/** Computes the TIP-1034 channel ID for a precompile channel descriptor. */
export declare function computeId(parameters: computeId.Parameters): Hex;
/** Type helpers for `computeId()`. */
export declare namespace computeId {
    /** Parameters that uniquely identify a TIP-1034 precompile channel. */
    type Parameters = ChannelDescriptor & {
        /** Chain ID included in the channel ID preimage. */
        chainId: number;
        /** Escrow contract/precompile address. Defaults to the canonical TIP-1034 address. */
        escrow?: Address | undefined;
    };
}
/** Input for deriving the transaction body used by TIP-1034 channel identity hashing. */
export type ExpiringNonceHashTransactionParameters = {
    /** Deserialized Tempo transaction that opened the channel. */
    transaction: ExpiringNonceTransaction;
    /** Whether the transaction will receive a fee-payer co-signature after payer signing. */
    feePayer?: Account | true | undefined;
};
/**
 * Returns the sender-signed transaction body used for TIP-1034 `expiringNonceHash`.
 *
 * Fee-payer co-signing happens after payer signing and must not affect the channel ID preimage.
 */
export declare function transactionForExpiringNonceHash(parameters: ExpiringNonceHashTransactionParameters): ExpiringNonceTransaction;
/**
 * Computes the TIP-1034 `expiringNonceHash` for a channel-opening Tempo transaction.
 *
 * This delegates to viem's Tempo sender-scoped hash helper, which matches the node's
 * `keccak256(encodeForSigning || sender)` consensus preimage. mppx intentionally does
 * not duplicate Tempo transaction encoding logic here.
 */
export declare function computeExpiringNonceHash(transaction: ExpiringNonceTransaction, parameters: {
    sender: Address;
}): Hex;
//# sourceMappingURL=Channel.d.ts.map