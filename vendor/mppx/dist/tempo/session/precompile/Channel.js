import { AbiParameters, Hash, Hex as OxHex } from 'ox';
import { TxEnvelopeTempo } from 'ox/tempo';
import { tip20ChannelEscrow } from './Protocol.js';
/** Resolves the descriptor's effective voucher signer; zero delegates to the payer. */
export function resolveAuthorizedSigner(descriptor) {
    return BigInt(descriptor.authorizedSigner) === 0n ? descriptor.payer : descriptor.authorizedSigner;
}
/** Computes the TIP-1034 channel ID for a precompile channel descriptor. */
export function computeId(parameters) {
    const encoded = AbiParameters.encode(AbiParameters.from([
        'address payer',
        'address payee',
        'address operator',
        'address token',
        'bytes32 salt',
        'address authorizedSigner',
        'bytes32 expiringNonceHash',
        'address escrow',
        'uint256 chainId',
    ]), [
        parameters.payer,
        parameters.payee,
        parameters.operator,
        parameters.token,
        parameters.salt,
        parameters.authorizedSigner,
        parameters.expiringNonceHash,
        parameters.escrow ?? tip20ChannelEscrow,
        BigInt(parameters.chainId),
    ]);
    return Hash.keccak256(encoded);
}
function encodeTempoTransactionForSigning(transaction) {
    // ox exposes the exact Tempo signing encoder we need, but its public type
    // does not include viem's request-time fee-payer fields. Keep the bridge at
    // the encoder boundary so channel ID derivation stays explicit.
    return TxEnvelopeTempo.encodeForSigning(transaction);
}
/**
 * Returns the sender-signed transaction body used for TIP-1034 `expiringNonceHash`.
 *
 * Fee-payer co-signing happens after payer signing and must not affect the channel ID preimage.
 */
export function transactionForExpiringNonceHash(parameters) {
    const { feePayer, transaction } = parameters;
    if (!feePayer)
        return transaction;
    return { ...transaction, feePayerSignature: null };
}
/**
 * Computes the TIP-1034 `expiringNonceHash` for a channel-opening Tempo transaction.
 *
 * This delegates to viem's Tempo sender-scoped hash helper, which matches the node's
 * `keccak256(encodeForSigning || sender)` consensus preimage. mppx intentionally does
 * not duplicate Tempo transaction encoding logic here.
 */
export function computeExpiringNonceHash(transaction, parameters) {
    return Hash.keccak256(OxHex.concat(encodeTempoTransactionForSigning(transaction), parameters.sender));
}
//# sourceMappingURL=Channel.js.map