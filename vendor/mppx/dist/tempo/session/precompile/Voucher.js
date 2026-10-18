import { Channel, SignatureEnvelope } from 'ox/tempo';
import { hashTypedData } from 'viem';
import { signTypedData } from 'viem/actions';
import { Account as TempoAccount } from 'viem/tempo';
import * as TempoAddress from '../../internal/address.js';
import { uint96 } from './Protocol.js';
/** Must match the on-chain TIP-20 channel reserve DOMAIN_SEPARATOR name. */
const DOMAIN_NAME = 'TIP20 Channel Reserve';
/** Must match the on-chain TIP20 channel escrow DOMAIN_SEPARATOR version. */
const DOMAIN_VERSION = '1';
/**
 * EIP-712 domain for voucher signing.
 */
export function getVoucherDomain(escrowContract, chainId) {
    return {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId,
        verifyingContract: escrowContract,
    };
}
/**
 * EIP-712 types for voucher signing.
 * Matches @tempo/stream-channels/voucher and on-chain VOUCHER_TYPEHASH.
 */
export const voucherTypes = {
    Voucher: [
        { name: 'channelId', type: 'bytes32' },
        { name: 'cumulativeAmount', type: 'uint96' },
    ],
};
function getVoucherDigest(chainId, voucher) {
    return Channel.getVoucherSignPayload({
        chainId,
        channelId: voucher.channelId,
        cumulativeAmount: voucher.cumulativeAmount,
    });
}
function getVoucherPayload(verifyingContract, chainId, voucher) {
    if (verifyingContract.toLowerCase() === Channel.address.toLowerCase())
        return getVoucherDigest(chainId, voucher);
    return hashTypedData({
        domain: getVoucherDomain(verifyingContract, chainId),
        types: voucherTypes,
        primaryType: 'Voucher',
        message: {
            channelId: voucher.channelId,
            cumulativeAmount: voucher.cumulativeAmount,
        },
    });
}
function isPrimitiveEnvelope(type) {
    return type === 'secp256k1' || type === 'p256' || type === 'webAuthn';
}
function signCanonicalTempoVoucher(account, parameters) {
    // viem/tempo's canonical TIP-1034 voucher signer accepts Tempo account
    // extensions that are wider than viem's base Account type. Keep that
    // compatibility bridge here and fall back to generic EIP-712 below.
    return TempoAccount.signVoucher(account, {
        chainId: parameters.chainId,
        channel: parameters.channelId,
        cumulativeAmount: parameters.cumulativeAmount,
    });
}
/**
 * Sign a voucher with an account.
 */
export async function signVoucher(client, account, voucher, verifyingContract, chainId) {
    const signature = await (async () => {
        if (verifyingContract.toLowerCase() === Channel.address.toLowerCase()) {
            try {
                return await signCanonicalTempoVoucher(account, {
                    chainId,
                    channelId: voucher.channelId,
                    cumulativeAmount: voucher.cumulativeAmount,
                });
            }
            catch { }
        }
        return signTypedData(client, {
            account,
            domain: getVoucherDomain(verifyingContract, chainId),
            types: voucherTypes,
            primaryType: 'Voucher',
            message: voucher,
        });
    })();
    const envelope = SignatureEnvelope.from(signature);
    if (!isPrimitiveEnvelope(envelope.type))
        throw new Error(`TIP-1034 vouchers require a TIP-1020 primitive signature; received "${envelope.type}".`);
    return SignatureEnvelope.serialize(envelope);
}
/**
 * Verify a voucher signature matches the expected signer.
 *
 * Accepts canonical TIP-1020 primitive signatures. Keychain wrappers,
 * multisig signatures, and magic-suffixed encodings are rejected.
 */
export function verifyVoucher(escrowContract, chainId, voucher, expectedSigner) {
    try {
        const envelope = SignatureEnvelope.from(voucher.signature);
        if (!isPrimitiveEnvelope(envelope.type))
            return false;
        if (SignatureEnvelope.serialize(envelope).toLowerCase() !== voucher.signature.toLowerCase())
            return false;
        const payload = getVoucherPayload(escrowContract, chainId, voucher);
        const signer = SignatureEnvelope.extractAddress({ payload, signature: envelope });
        const valid = SignatureEnvelope.verify(envelope, { address: signer, payload });
        return valid && TempoAddress.isEqual(signer, expectedSigner);
    }
    catch {
        return false;
    }
}
/**
 * Parse a voucher from credential payload.
 */
export function parseVoucherFromPayload(channelId, cumulativeAmount, signature) {
    return {
        channelId,
        cumulativeAmount: uint96(BigInt(cumulativeAmount)),
        signature,
    };
}
//# sourceMappingURL=Voucher.js.map