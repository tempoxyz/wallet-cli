import { AbiParameters, Hash } from 'ox';
/**
 * Computes a channel ID from its parameters.
 *
 * Mirrors the onchain `computeChannelId` function: `keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, escrowContract, chainId))`.
 */
export function computeId(parameters) {
    const encoded = AbiParameters.encode(AbiParameters.from([
        'address payer',
        'address payee',
        'address token',
        'bytes32 salt',
        'address authorizedSigner',
        'address escrowContract',
        'uint256 chainId',
    ]), [
        parameters.payer,
        parameters.payee,
        parameters.token,
        parameters.salt,
        parameters.authorizedSigner,
        parameters.escrowContract,
        BigInt(parameters.chainId),
    ]);
    return Hash.keccak256(encoded);
}
//# sourceMappingURL=Channel.js.map