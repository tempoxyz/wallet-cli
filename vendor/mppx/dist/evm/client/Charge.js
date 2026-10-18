import { getAddress, parseUnits } from 'viem';
import * as Credential from '../../Credential.js';
import * as Method from '../../Method.js';
import * as x402_Exact from '../../x402/client/Exact.js';
import * as x402_ChallengeBrand from '../../x402/internal/ChallengeBrand.js';
import * as z from '../../zod.js';
import * as Assets from '../Assets.js';
import * as Methods from '../Methods.js';
import * as Types from '../Types.js';
/**
 * Creates an EVM charge client method.
 *
 * Signs native Payment-auth `authorization` credentials for EVM charges. It
 * also keeps x402 exact signing for x402 compatibility challenges.
 */
export function charge(parameters) {
    return Method.toClient(Methods.charge, {
        canHandleChallenge({ challenge }) {
            if (!isX402Challenge(challenge))
                return true;
            return x402_Exact.canHandleChallenge({
                challenge: challenge,
                config: parameters,
            });
        },
        context: z.object({
            account: z.optional(z.custom()),
        }),
        async createCredential({ challenge, context }) {
            if (isX402Challenge(challenge))
                return x402_Exact.createCredential({
                    challenge: challenge,
                    config: parameters,
                    context,
                });
            const account = (context?.account ?? parameters.account);
            if (!account?.signTypedData)
                throw new Error('EVM authorization requires a typed-data signer.');
            const request = challenge.request;
            assertPolicy(parameters, request);
            if (!request.methodDetails.credentialTypes?.includes('authorization')) {
                throw new Error('EVM authorization is not accepted by this challenge.');
            }
            if (request.methodDetails.splits?.length) {
                throw new Error('EVM authorization does not support payment splits.');
            }
            const authorization = resolveAuthorization(parameters, request);
            const validBefore = challenge.expires
                ? Math.floor(new Date(challenge.expires).getTime() / 1000).toString()
                : (Math.floor(Date.now() / 1000) + 300).toString();
            const payload = {
                from: getAddress(account.address),
                nonce: Types.challengeHash(challenge),
                signature: await account.signTypedData({
                    domain: Types.authorizationDomain({
                        authorization,
                        chainId: request.methodDetails.chainId,
                        currency: request.currency,
                    }),
                    message: {
                        from: getAddress(account.address),
                        nonce: Types.challengeHash(challenge),
                        to: getAddress(request.recipient),
                        validAfter: 0n,
                        validBefore: BigInt(validBefore),
                        value: BigInt(request.amount),
                    },
                    primaryType: 'TransferWithAuthorization',
                    types: Types.authorizationTypes,
                }),
                to: getAddress(request.recipient),
                type: 'authorization',
                validAfter: '0',
                validBefore,
                value: request.amount,
            };
            return Credential.serialize(Credential.from({
                challenge,
                payload,
                source: Types.toSource({
                    address: getAddress(account.address),
                    chainId: request.methodDetails.chainId,
                }),
            }));
        },
    });
}
function isX402Challenge(challenge) {
    return (x402_ChallengeBrand.is(challenge) &&
        challenge.request.scheme === 'exact' &&
        typeof challenge.request.network === 'string');
}
function assertPolicy(parameters, request) {
    const chainId = request.methodDetails.chainId;
    const network = Types.networkOf(chainId);
    if (parameters.networks && !parameters.networks.includes(chainId))
        throw new Error(`EVM chain ID is not allowed: ${chainId}.`);
    const currencies = parameters.currencies ?? parameters.assets;
    if (currencies?.some((currency) => Assets.isRawAddress(currency)) && !parameters.networks?.length)
        throw new Error('EVM raw currency allowlists require networks.');
    if (currencies) {
        const acceptedCurrency = getAddress(request.currency);
        const allowed = currencies.some((currency) => Assets.matches(currency, acceptedCurrency, network));
        if (!allowed)
            throw new Error(`EVM currency is not allowed: ${acceptedCurrency}.`);
    }
    if (parameters.maxAtomicAmount !== undefined &&
        BigInt(request.amount) > BigInt(parameters.maxAtomicAmount))
        throw new Error('EVM charge amount exceeds maxAtomicAmount.');
    if (parameters.maxAmount !== undefined) {
        const decimals = decimalsOfAcceptedCurrency(parameters, request);
        if (decimals === undefined)
            throw new Error('EVM charge maxAmount requires currency decimals.');
        if (BigInt(request.amount) > parseUnits(parameters.maxAmount, decimals))
            throw new Error('EVM charge amount exceeds maxAmount.');
    }
}
function resolveAuthorization(parameters, request) {
    const currencies = parameters.currencies ?? parameters.assets;
    const acceptedCurrency = getAddress(request.currency);
    const network = Types.networkOf(request.methodDetails.chainId);
    const currency = currencies?.find((currency) => Assets.matches(currency, acceptedCurrency, network));
    const resolved = currency ? Assets.resolve(currency, network) : undefined;
    if (resolved?.transfer?.type === Types.eip3009)
        return {
            name: resolved.transfer.name,
            version: resolved.transfer.version,
        };
    if (parameters.authorization)
        return parameters.authorization;
    throw new Error('EVM authorization requires token name and version.');
}
function decimalsOfAcceptedCurrency(parameters, request) {
    const currencies = parameters.currencies ?? parameters.assets;
    const acceptedCurrency = getAddress(request.currency);
    const network = Types.networkOf(request.methodDetails.chainId);
    const currency = currencies?.find((currency) => Assets.matches(currency, acceptedCurrency, network));
    const resolved = currency ? Assets.resolve(currency, network) : undefined;
    if (resolved?.decimals !== undefined)
        return resolved.decimals;
    return parameters.decimals;
}
//# sourceMappingURL=Charge.js.map