import { Signature } from 'ox';
import { SignatureEnvelope } from 'ox/tempo';
import { hashTypedData } from 'viem';
import { signTypedData } from 'viem/actions';
import { getAccountSignerAddress, isAccessKeyAccount } from '../../internal/account.js';
/** Must match the on-chain TempoStreamChannel DOMAIN_SEPARATOR name. */
const DOMAIN_NAME = 'Tempo Stream Channel';
/** Must match the on-chain TempoStreamChannel DOMAIN_SEPARATOR version. */
const DOMAIN_VERSION = '1';
/**
 * EIP-712 domain for voucher signing.
 */
function getVoucherDomain(escrowContract, chainId) {
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
const voucherTypes = {
    Voucher: [
        { name: 'channelId', type: 'bytes32' },
        { name: 'cumulativeAmount', type: 'uint128' },
    ],
};
const acceptTip1020VoucherSignatures = false;
function getVoucherMessage(message) {
    return {
        channelId: message.channelId,
        cumulativeAmount: message.cumulativeAmount,
    };
}
function getVoucherDigest(escrowContract, chainId, message) {
    return hashTypedData({
        domain: getVoucherDomain(escrowContract, chainId),
        types: voucherTypes,
        primaryType: 'Voucher',
        message: getVoucherMessage(message),
    });
}
async function signVoucherTypedData(client, account, message, escrowContract, chainId) {
    return signTypedData(client, {
        account,
        domain: getVoucherDomain(escrowContract, chainId),
        types: voucherTypes,
        primaryType: 'Voucher',
        message: getVoucherMessage(message),
    });
}
function normalizeVoucherSignature(signature) {
    const envelope = SignatureEnvelope.from(signature);
    if (envelope.type === 'keychain') {
        if (envelope.inner.type !== 'secp256k1')
            throw new Error('Session vouchers only unwrap secp256k1 keychain signatures; pass a direct voucherSigner for other key types.');
        return Signature.toHex(envelope.inner.signature);
    }
    // Tempo local accounts may append signature-envelope magic bytes for RPC
    // routing. Voucher signatures are direct envelopes without magic bytes.
    return SignatureEnvelope.serialize(envelope);
}
function acceptsVoucherEnvelope(envelope) {
    if (envelope.type === 'keychain')
        return false;
    if (envelope.type === 'secp256k1')
        return true;
    return acceptTip1020VoucherSignatures;
}
function assertSupportedVoucherEnvelope(envelope) {
    if (acceptsVoucherEnvelope(envelope))
        return;
    throw new Error('Session vouchers only support secp256k1 signatures until TIP-1020 voucher verification is enabled.');
}
/**
 * Sign a voucher with an account.
 */
export async function signVoucher(client, account, message, escrowContract, chainId, voucherSigner) {
    const signer = voucherSigner ?? account;
    const expectedSigner = getAccountSignerAddress(signer);
    const digest = getVoucherDigest(escrowContract, chainId, message);
    const signature = isAccessKeyAccount(signer)
        ? await signer.sign({ hash: digest, raw: true })
        : await signVoucherTypedData(client, signer, message, escrowContract, chainId);
    const normalized = normalizeVoucherSignature(signature);
    const envelope = SignatureEnvelope.from(normalized);
    assertSupportedVoucherEnvelope(envelope);
    if (!SignatureEnvelope.verify(envelope, {
        address: expectedSigner,
        payload: digest,
    }))
        throw new Error('voucher signature does not match voucher signer');
    return normalized;
}
/**
 * Verify a voucher signature matches the expected signer.
 *
 * Accepts canonical raw secp256k1 voucher signatures.
 *
 * TIP-1020 voucher signatures will be enabled when onchain escrow verification ships.
 */
export async function verifyVoucher(escrowContract, chainId, voucher, expectedSigner) {
    try {
        const envelope = SignatureEnvelope.from(voucher.signature);
        if (!acceptsVoucherEnvelope(envelope))
            return false;
        const canonical = SignatureEnvelope.serialize(envelope);
        if (canonical.toLowerCase() !== voucher.signature.toLowerCase())
            return false;
        return SignatureEnvelope.verify(envelope, {
            address: expectedSigner,
            payload: getVoucherDigest(escrowContract, chainId, voucher),
        });
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
        cumulativeAmount: BigInt(cumulativeAmount),
        signature,
    };
}
//# sourceMappingURL=Voucher.js.map