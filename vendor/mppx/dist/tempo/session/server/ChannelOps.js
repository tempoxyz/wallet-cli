import { decodeFunctionData, isAddressEqual } from 'viem';
import * as Channel from '../precompile/Channel.js';
import { escrowAbi } from '../precompile/escrow.abi.js';
import { tip20ChannelEscrow } from '../precompile/Protocol.js';
import { uint96 } from '../precompile/Protocol.js';
/** Validates that calldata contains exactly one TIP-1034 approve-less `open` call. */
export function parseOpenCall(parameters) {
    let decoded;
    try {
        decoded = decodeFunctionData({ abi: escrowAbi, data: parameters.data });
    }
    catch {
        throw new Error('Expected TIP-1034 open calldata.');
    }
    if (decoded.functionName !== 'open')
        throw new Error('Expected TIP-1034 open calldata.');
    const [payee, operator, token, deposit, salt, authorizedSigner] = decoded.args;
    const expected = parameters.expected;
    if (expected?.payee && !isAddressEqual(payee, expected.payee))
        throw new Error('TIP-1034 open payee does not match challenge.');
    if (expected?.operator && !isAddressEqual(operator, expected.operator))
        throw new Error('TIP-1034 open operator does not match challenge.');
    if (expected?.token && !isAddressEqual(token, expected.token))
        throw new Error('TIP-1034 open token does not match challenge.');
    if (expected?.authorizedSigner && !isAddressEqual(authorizedSigner, expected.authorizedSigner))
        throw new Error('TIP-1034 open authorizedSigner does not match credential.');
    const validatedDeposit = uint96(deposit);
    if (expected?.deposit !== undefined && validatedDeposit !== expected.deposit)
        throw new Error('TIP-1034 open deposit does not match challenge.');
    return { payee, operator, token, deposit: validatedDeposit, salt, authorizedSigner };
}
function isSameChannelDescriptor(parameters) {
    const { actual, expected } = parameters;
    return (isAddressEqual(actual.payer, expected.payer) &&
        isAddressEqual(actual.payee, expected.payee) &&
        isAddressEqual(actual.operator, expected.operator) &&
        isAddressEqual(actual.token, expected.token) &&
        isAddressEqual(actual.authorizedSigner, expected.authorizedSigner) &&
        actual.salt.toLowerCase() === expected.salt.toLowerCase() &&
        actual.expiringNonceHash.toLowerCase() === expected.expiringNonceHash.toLowerCase());
}
/** Validates that calldata contains exactly one TIP-1034 descriptor-based `topUp` call. */
export function parseTopUpCall(parameters) {
    let decoded;
    try {
        decoded = decodeFunctionData({ abi: escrowAbi, data: parameters.data });
    }
    catch {
        throw new Error('Expected TIP-1034 topUp calldata.');
    }
    if (decoded.functionName !== 'topUp')
        throw new Error('Expected TIP-1034 topUp calldata.');
    const [descriptor, additionalDeposit] = decoded.args;
    const topUpDescriptor = descriptor;
    const expected = parameters.expected;
    if (expected?.descriptor) {
        if (!isSameChannelDescriptor({ actual: topUpDescriptor, expected: expected.descriptor }))
            throw new Error('TIP-1034 topUp descriptor does not match stored channel.');
    }
    const validatedAdditionalDeposit = uint96(additionalDeposit);
    if (expected?.additionalDeposit !== undefined &&
        validatedAdditionalDeposit !== expected.additionalDeposit)
        throw new Error('TIP-1034 topUp deposit does not match credential.');
    return {
        descriptor: topUpDescriptor,
        additionalDeposit: validatedAdditionalDeposit,
    };
}
/** Builds and validates a descriptor from an accepted open call and event expiring nonce hash. */
export function descriptorFromOpen(parameters) {
    const descriptor = {
        authorizedSigner: parameters.open.authorizedSigner,
        expiringNonceHash: parameters.expiringNonceHash,
        operator: parameters.open.operator,
        payee: parameters.open.payee,
        payer: parameters.payer,
        salt: parameters.open.salt,
        token: parameters.open.token,
    };
    if (parameters.channelId) {
        const computed = Channel.computeId({
            ...descriptor,
            chainId: parameters.chainId,
            escrow: parameters.escrow ?? tip20ChannelEscrow,
        });
        if (computed.toLowerCase() !== parameters.channelId.toLowerCase())
            throw new Error('TIP-1034 ChannelOpened channelId does not match descriptor.');
    }
    return descriptor;
}
//# sourceMappingURL=ChannelOps.js.map