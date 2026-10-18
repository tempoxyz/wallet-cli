import { getAddress, recoverTypedDataAddress } from 'viem';
import { VerificationFailedError } from '../../Errors.js';
import * as Method from '../../Method.js';
import * as Receipt from '../../Receipt.js';
import * as ServerTransport from '../../server/Transport.js';
import * as X402 from '../../x402/server/EvmCharge.js';
import * as Assets from '../Assets.js';
import * as Methods from '../Methods.js';
import * as Types from '../Types.js';
export function charge(parameters) {
    const config = resolveConfig(parameters);
    const paths = createPaths(config);
    const transport = httpTransport(paths);
    return Method.toServer(Methods.charge, {
        canOffer: parameters.canOffer,
        onPaymentSuccess: parameters.onPaymentSuccess,
        defaults: {
            chainId: config.chainId,
            currency: config.currency,
            credentialTypes: ['authorization'],
            decimals: config.decimals,
            recipient: config.recipient,
        },
        transport,
        async validate({ credential }) {
            const payload = credential.payload;
            const request = credential.challenge.request;
            const chainId = request.methodDetails.chainId;
            const isX402Credential = X402.isCredential(credential);
            if (!request.methodDetails.credentialTypes?.includes('authorization')) {
                throw new VerificationFailedError({
                    reason: 'EVM authorization credentials are not supported for this challenge',
                });
            }
            if (request.methodDetails.splits?.length) {
                throw new VerificationFailedError({
                    reason: 'EVM authorization credentials do not support splits',
                });
            }
            assertAddressEqual(payload.to, request.recipient, 'EVM authorization recipient mismatch');
            if (payload.value !== request.amount)
                throw new VerificationFailedError({ reason: 'EVM authorization amount mismatch' });
            if (!isX402Credential && payload.nonce !== Types.challengeHash(credential.challenge))
                throw new VerificationFailedError({ reason: 'EVM authorization challenge hash mismatch' });
            const now = BigInt(Math.floor(Date.now() / 1000));
            if (BigInt(payload.validAfter) > now)
                throw new VerificationFailedError({ reason: 'EVM authorization is not valid yet' });
            if (BigInt(payload.validBefore) <= now)
                throw new VerificationFailedError({ reason: 'EVM authorization has expired' });
            const signer = await recoverTypedDataAddress({
                domain: Types.authorizationDomain({
                    authorization: config.authorization,
                    chainId,
                    currency: request.currency,
                }),
                message: {
                    from: getAddress(payload.from),
                    nonce: payload.nonce,
                    to: getAddress(payload.to),
                    validAfter: BigInt(payload.validAfter),
                    validBefore: BigInt(payload.validBefore),
                    value: BigInt(payload.value),
                },
                primaryType: 'TransferWithAuthorization',
                signature: payload.signature,
                types: Types.authorizationTypes,
            });
            assertAddressEqual(signer, payload.from, 'EVM authorization signature mismatch');
            const source = Types.toSource({ address: getAddress(payload.from), chainId });
            if (credential.source && credential.source !== source) {
                throw new VerificationFailedError({ reason: 'EVM authorization source mismatch' });
            }
            const authorization = {
                credential,
                payload,
                request,
                source,
            };
            await config.validate?.(authorization);
            return {
                challenge: credential.challenge,
                credential,
                details: { payer: getAddress(payload.from) },
                intent: Methods.charge.intent,
                method: Methods.charge.name,
                request: credential.challenge.request,
                source,
            };
        },
        async broadcast({ credential }) {
            const payload = credential.payload;
            const request = credential.challenge.request;
            const settled = await config.settle({
                credential,
                payload,
                request,
                source: Types.toSource({
                    address: getAddress(payload.from),
                    chainId: request.methodDetails.chainId,
                }),
            });
            return Receipt.from({
                method: Types.paymentMethod,
                reference: settled.reference,
                status: 'success',
                timestamp: settled.timestamp ?? new Date().toISOString(),
            });
        },
    });
}
function resolveConfig(config) {
    const { currency, recipient } = config;
    let address;
    let authorization = config.authorization;
    let chainId = config.chainId;
    let decimals = config.decimals;
    if (Assets.isAsset(currency)) {
        chainId ??= Assets.toChainId(currency.network);
    }
    if (chainId !== undefined) {
        const resolved = Assets.resolve(currency, Types.networkOf(chainId));
        if (!resolved)
            throw new Error(`EVM currency is not available on chain ID ${chainId}.`);
        address = resolved.address;
        decimals ??= resolved.decimals;
        if (resolved.transfer?.type === Types.eip3009) {
            authorization ??= {
                name: resolved.transfer.name,
                version: resolved.transfer.version,
            };
        }
    }
    else if (Assets.isRawAddress(currency)) {
        address = currency;
    }
    else {
        throw new Error('EVM authorization requires `chainId`.');
    }
    if (!authorization)
        throw new Error('EVM authorization requires `authorization` metadata.');
    if (chainId === undefined)
        throw new Error('EVM authorization requires `chainId`.');
    if (decimals === undefined)
        throw new Error('EVM authorization requires `decimals`.');
    const x402 = X402.resolveOptions({
        authorization,
        options: config.x402,
    });
    const settle = config.settle ?? (x402?.facilitator ? X402.settleWithFacilitator(x402) : undefined);
    if (!settle)
        throw new Error('EVM authorization requires `settle` or `x402.facilitator`.');
    return {
        authorization,
        chainId,
        currency: getAddress(address),
        decimals,
        recipient: getAddress(recipient),
        settle,
        validate: !config.settle && x402.facilitator
            ? (parameters) => X402.verifyWithFacilitator(x402, parameters)
            : undefined,
        x402,
    };
}
function createPaths(config) {
    return {
        mpp: createMppPath(),
        x402: X402.createPath(config.x402),
    };
}
function createMppPath() {
    const transport = ServerTransport.http();
    return {
        bindCredential: (options) => transport.bindCredential?.(options) ?? options.credential,
        captureRequest: transport.captureRequest,
        getCredential: transport.getCredential,
        respondChallenge: (options) => transport.respondChallenge(options),
        respondReceipt: (options, response) => transport.respondReceipt({ ...options, response }),
    };
}
function httpTransport(paths) {
    return ServerTransport.from({
        name: 'evm-http',
        captureRequest: paths.mpp.captureRequest,
        getCredential(input) {
            return paths.mpp.getCredential(input) ?? paths.x402.getCredential(input);
        },
        bindCredential(options) {
            if (X402.isPendingCredential(options.credential))
                return paths.x402.bindCredential(options);
            return paths.mpp.bindCredential?.(options) ?? options.credential;
        },
        async respondChallenge(options) {
            const response = await paths.mpp.respondChallenge(options);
            return paths.x402.respondChallenge(options, response);
        },
        respondReceipt(options) {
            const response = paths.mpp.respondReceipt(options, options.response);
            return paths.x402.respondReceipt(options, response);
        },
    });
}
function assertAddressEqual(actual, expected, reason) {
    if (getAddress(actual) === getAddress(expected))
        return;
    throw new VerificationFailedError({ reason });
}
//# sourceMappingURL=Charge.js.map