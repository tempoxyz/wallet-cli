import { getAddress, parseUnits } from 'viem';
import * as Assets from '../Assets.js';
import * as Header from '../Header.js';
import * as RouteBinding from '../internal/RouteBinding.js';
import * as Types from '../Types.js';
/**
 * Creates an x402 exact `PAYMENT-SIGNATURE` credential.
 */
export async function createCredential(parameters) {
    const account = (parameters.context?.account ?? parameters.config.account);
    if (!account?.signTypedData)
        throw new Error('x402 exact requires a typed-data signer.');
    const request = parameters.challenge.request;
    const accepted = Types.toPaymentRequirements(request);
    assertPolicy(parameters.config, accepted);
    if (!request.resource)
        throw new Error('x402 exact EIP-3009 requires resource information.');
    const extensions = request.extensions?.mppx
        ? withNonceSalt(request.extensions)
        : request.extensions;
    const transferMethod = accepted.extra?.assetTransferMethod ?? 'eip3009';
    if (transferMethod !== 'eip3009')
        throw new Error(`x402 exact ${String(transferMethod)} signing is not implemented yet.`);
    const name = accepted.extra?.name;
    const version = accepted.extra?.version;
    if (typeof name !== 'string' || typeof version !== 'string')
        throw new Error('x402 exact EIP-3009 requires token name and version.');
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
        from: getAddress(account.address),
        nonce: extensions?.mppx
            ? RouteBinding.nonce({
                accepted,
                extensions,
                resource: request.resource,
            })
            : randomAuthorizationNonce(),
        to: getAddress(accepted.payTo),
        validAfter: (now - 600).toString(),
        validBefore: (now + accepted.maxTimeoutSeconds).toString(),
        value: accepted.amount,
    };
    const signature = await account.signTypedData({
        domain: {
            chainId: chainIdOf(accepted.network),
            name,
            verifyingContract: getAddress(accepted.asset),
            version,
        },
        message: {
            ...authorization,
            value: BigInt(authorization.value),
            validAfter: BigInt(authorization.validAfter),
            validBefore: BigInt(authorization.validBefore),
        },
        primaryType: 'TransferWithAuthorization',
        types: authorizationTypes,
    });
    return Header.encodePaymentSignature({
        accepted,
        ...(extensions ? { extensions } : {}),
        payload: {
            authorization,
            signature,
        },
        ...(request.resource ? { resource: request.resource } : {}),
        x402Version: 2,
    });
}
/** Returns whether this client can sign the given x402 exact challenge. */
export function canHandleChallenge(parameters) {
    const request = parameters.challenge.request;
    let accepted;
    try {
        accepted = Types.toPaymentRequirements(request);
        assertPolicy(parameters.config, accepted);
    }
    catch {
        return false;
    }
    if (!request.resource)
        return false;
    const transferMethod = accepted.extra?.assetTransferMethod ?? 'eip3009';
    if (transferMethod !== 'eip3009')
        return false;
    const name = accepted.extra?.name;
    const version = accepted.extra?.version;
    return typeof name === 'string' && typeof version === 'string';
}
const authorizationTypes = {
    TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
    ],
};
function chainIdOf(network) {
    return Number(network.slice(Types.evmNetworkPrefix.length));
}
function assertPolicy(parameters, accepted) {
    const chainId = chainIdOf(accepted.network);
    if (parameters.networks && !parameters.networks.includes(chainId))
        throw new Error(`x402 exact chain ID is not allowed: ${chainId}.`);
    const currencies = parameters.currencies ?? parameters.assets;
    if (currencies?.some((currency) => Assets.isRawAddress(currency)) && !parameters.networks?.length)
        throw new Error('x402 exact raw currency allowlists require networks.');
    if (currencies) {
        const acceptedCurrency = getAddress(accepted.asset);
        const allowed = currencies.some((currency) => Assets.matches(currency, acceptedCurrency, accepted.network));
        if (!allowed)
            throw new Error(`x402 exact currency is not allowed: ${acceptedCurrency}.`);
    }
    if (parameters.maxAtomicAmount !== undefined &&
        BigInt(accepted.amount) > BigInt(parameters.maxAtomicAmount))
        throw new Error('x402 exact amount exceeds maxAtomicAmount.');
    if (parameters.maxAmount !== undefined) {
        const decimals = decimalsOfAcceptedCurrency(parameters, accepted);
        if (decimals === undefined)
            throw new Error('x402 exact maxAmount requires currency decimals.');
        if (BigInt(accepted.amount) > parseUnits(parameters.maxAmount, decimals))
            throw new Error('x402 exact amount exceeds maxAmount.');
    }
}
function decimalsOfAcceptedCurrency(parameters, accepted) {
    const currencies = parameters.currencies ?? parameters.assets;
    const acceptedCurrency = getAddress(accepted.asset);
    const currency = currencies?.find((currency) => Assets.matches(currency, acceptedCurrency, accepted.network));
    const resolved = currency ? Assets.resolve(currency, accepted.network) : undefined;
    if (resolved?.decimals !== undefined)
        return resolved.decimals;
    return parameters.decimals;
}
function withNonceSalt(extensions) {
    const mppx = extensions.mppx;
    if (!mppx)
        return extensions;
    return {
        ...extensions,
        mppx: {
            ...mppx,
            info: {
                ...mppx.info,
                nonce: randomNonceSalt(),
            },
        },
    };
}
function randomNonceSalt() {
    return randomBytes32().slice(2);
}
function randomAuthorizationNonce() {
    return randomBytes32();
}
function randomBytes32() {
    const crypto = globalThis.crypto;
    if (!crypto?.getRandomValues)
        throw new Error('x402 exact requires crypto randomness.');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
//# sourceMappingURL=Exact.js.map