import { Base64, Hex } from 'ox';
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo';
import { isAddress, isAddressEqual } from 'viem';
import { VerificationFailedError } from '../../Errors.js';
/** 4-byte selector for TIP-20 `transfer(address,uint256)`. */
export const transferSelector = '0xa9059cbb';
/** 4-byte selector for TIP-20 `transferWithMemo(address,uint256,bytes32)`. */
export const transferWithMemoSelector = '0x95777d59';
const uint64Max = (1n << 64n) - 1n;
const subscriptionPeriodUnitSeconds = {
    dev_second: 1n,
    day: 86400n,
    week: 604800n,
};
/**
 * Converts a subscription expiry timestamp into the Unix seconds value required by Tempo key
 * authorizations.
 */
export function toSubscriptionExpiryDate(subscriptionExpires) {
    return subscriptionExpires instanceof Date ? subscriptionExpires : new Date(subscriptionExpires);
}
export function toSubscriptionExpirySeconds(subscriptionExpires) {
    const milliseconds = subscriptionExpires.getTime();
    if (!Number.isFinite(milliseconds)) {
        throw new VerificationFailedError({ reason: 'subscriptionExpires is invalid' });
    }
    if (milliseconds % 1_000 !== 0) {
        throw new VerificationFailedError({
            reason: 'subscriptionExpires must be representable as whole seconds',
        });
    }
    const seconds = milliseconds / 1_000;
    if (seconds <= 0 || !Number.isSafeInteger(seconds)) {
        throw new VerificationFailedError({
            reason: 'subscriptionExpires cannot be represented in a Tempo key authorization',
        });
    }
    return seconds;
}
/**
 * Converts the shared subscription period fields into the numeric period accepted by Tempo key
 * authorizations.
 */
export function toSubscriptionPeriodSeconds(request) {
    if (!/^[1-9]\d*$/.test(request.periodCount)) {
        throw new VerificationFailedError({ reason: 'periodCount is invalid' });
    }
    const unitSeconds = subscriptionPeriodUnitSeconds[request.periodUnit];
    if (unitSeconds === undefined) {
        throw new VerificationFailedError({ reason: 'periodUnit is invalid' });
    }
    const value = BigInt(request.periodCount) * unitSeconds;
    if (value > uint64Max) {
        throw new VerificationFailedError({
            reason: 'subscription period cannot be represented as an unsigned 64-bit integer',
        });
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new VerificationFailedError({
            reason: 'subscription period cannot be represented exactly by this Tempo client',
        });
    }
    return Number(value);
}
/**
 * Verifies that the subscription duration is representable and lasts beyond the payment challenge.
 */
export function assertSubscriptionTiming(parameters) {
    const { challengeExpires, request } = parameters;
    toSubscriptionPeriodSeconds(request);
    const subscriptionExpiry = toSubscriptionExpirySeconds(toSubscriptionExpiryDate(request.subscriptionExpires));
    if (challengeExpires) {
        const challengeExpiry = Math.floor(new Date(challengeExpires).getTime() / 1_000);
        if (!Number.isFinite(challengeExpiry) || subscriptionExpiry <= challengeExpiry) {
            throw new VerificationFailedError({
                reason: 'subscriptionExpires must be strictly later than challenge expires',
            });
        }
    }
}
/** Builds the Tempo access-key call scopes required for a subscription payment. */
export function getSubscriptionScopes(request) {
    const currency = normalizeAddress(request.currency, 'currency');
    const recipient = normalizeAddress(request.recipient, 'recipient');
    return [
        {
            address: currency,
            selector: transferWithMemoSelector,
            recipients: [recipient],
        },
    ];
}
/** Builds the RPC `allowedCalls` payload passed to `wallet_authorizeAccessKey`. */
export function getSubscriptionRpcAllowedCalls(request) {
    const [transferWithMemo] = getSubscriptionScopes(request);
    return [
        {
            target: normalizeAddress(request.currency, 'currency'),
            selectorRules: [
                {
                    selector: transferWithMemo.selector,
                    recipients: transferWithMemo.recipients,
                },
            ],
        },
    ];
}
/** Decodes the server-issued challenge identifier for use as a signed Tempo witness. */
export function getSubscriptionChallengeWitness(challengeId) {
    try {
        const witness = Hex.fromBytes(Base64.toBytes(challengeId));
        if (Hex.size(witness) !== 32)
            throw new Error('invalid challenge id size');
        return witness;
    }
    catch {
        throw new VerificationFailedError({ reason: 'challenge id must encode 32 bytes' });
    }
}
/**
 * Creates and signs a Tempo key authorization for subscription payments when the account can sign
 * arbitrary hashes locally.
 */
export async function signSubscriptionKeyAuthorization(parameters) {
    const { accessKey, account, challengeId, chainId, request } = parameters;
    if (typeof account.sign !== 'function')
        return undefined;
    const authorization = createUnsignedAuthorization({
        accessKey,
        challengeId,
        chainId,
        request,
    });
    const signature = await account.sign({
        hash: KeyAuthorization.getSignPayload(authorization),
    });
    const signatureEnvelope = SignatureEnvelope.from(signature);
    if (signatureEnvelope.type === 'keychain' || signatureEnvelope.type === 'multisig') {
        throw new VerificationFailedError({
            reason: 'keyAuthorization must use a primitive signature',
        });
    }
    return KeyAuthorization.from(authorization, {
        signature,
    });
}
/**
 * Verifies that a subscription credential contains a key authorization scoped to the requested
 * token, recipient, amount, period, expiry, chain, and server-issued access key.
 */
export function verifySubscriptionKeyAuthorization(parameters) {
    const { accessKey, challengeId, chainId, payload, request } = parameters;
    if (payload.type !== 'keyAuthorization') {
        throw new VerificationFailedError({ reason: 'invalid keyAuthorization payload' });
    }
    const authorization = deserializeAuthorization(payload.signature);
    const signature = getPrimitiveSignature(authorization);
    assertAuthorizationKey({
        accessKey,
        authorization,
        chainId,
    });
    if (authorization.witness?.toLowerCase() !== getSubscriptionChallengeWitness(challengeId)) {
        throw new VerificationFailedError({ reason: 'keyAuthorization challenge mismatch' });
    }
    assertAuthorizationExpiry(authorization, request);
    assertAuthorizationLimit(getSingleTokenLimit(authorization), request);
    assertAuthorizationScopes(authorization.scopes, request);
    const source = recoverAuthorizationSource(authorization, signature);
    return {
        authorization,
        source: {
            address: source,
            chainId,
        },
    };
}
function createUnsignedAuthorization(parameters) {
    const { accessKey, challengeId, chainId, request } = parameters;
    return KeyAuthorization.from({
        address: normalizeAddress(accessKey.accessKeyAddress, 'accessKeyAddress'),
        chainId: BigInt(chainId),
        expiry: toSubscriptionExpirySeconds(toSubscriptionExpiryDate(request.subscriptionExpires)),
        limits: [
            {
                token: normalizeAddress(request.currency, 'currency'),
                limit: BigInt(request.amount),
                period: toSubscriptionPeriodSeconds(request),
            },
        ],
        scopes: getSubscriptionScopes(request),
        type: accessKey.keyType,
        witness: getSubscriptionChallengeWitness(challengeId),
    });
}
function deserializeAuthorization(signature) {
    try {
        return KeyAuthorization.deserialize(signature);
    }
    catch (error) {
        if (error instanceof KeyAuthorization.InvalidSignatureTypeError) {
            throw new VerificationFailedError({
                reason: 'keyAuthorization must use a primitive signature',
            });
        }
        throw new VerificationFailedError({ reason: 'invalid keyAuthorization payload' });
    }
}
function getPrimitiveSignature(authorization) {
    const signature = authorization.signature;
    if (!signature) {
        throw new VerificationFailedError({
            reason: 'keyAuthorization must use a primitive signature',
        });
    }
    return signature;
}
function assertAuthorizationKey(parameters) {
    const { accessKey, authorization, chainId } = parameters;
    if (authorization.chainId !== BigInt(chainId)) {
        throw new VerificationFailedError({ reason: 'keyAuthorization chainId mismatch' });
    }
    if (!accessKey)
        return;
    if (!isAddressEqual(authorization.address, normalizeAddress(accessKey.accessKeyAddress, 'accessKeyAddress'))) {
        throw new VerificationFailedError({ reason: 'keyAuthorization access key mismatch' });
    }
    if (authorization.type !== accessKey.keyType) {
        throw new VerificationFailedError({ reason: 'keyAuthorization key type mismatch' });
    }
}
function assertAuthorizationExpiry(authorization, request) {
    assertSubscriptionTiming({ request });
    if (authorization.expiry !==
        toSubscriptionExpirySeconds(toSubscriptionExpiryDate(request.subscriptionExpires))) {
        throw new VerificationFailedError({ reason: 'keyAuthorization expiry mismatch' });
    }
}
function getSingleTokenLimit(authorization) {
    const [limit] = authorization.limits ?? [];
    if (!limit || authorization.limits?.length !== 1) {
        throw new VerificationFailedError({
            reason: 'keyAuthorization must contain exactly one token limit',
        });
    }
    return limit;
}
function assertAuthorizationLimit(limit, request) {
    if (!isAddressEqual(limit.token, normalizeAddress(request.currency, 'currency'))) {
        throw new VerificationFailedError({ reason: 'keyAuthorization currency mismatch' });
    }
    if (limit.limit !== BigInt(request.amount)) {
        throw new VerificationFailedError({ reason: 'keyAuthorization amount mismatch' });
    }
    if (limit.period !== toSubscriptionPeriodSeconds(request)) {
        throw new VerificationFailedError({ reason: 'keyAuthorization period mismatch' });
    }
}
function assertAuthorizationScopes(scopes, request) {
    if (!scopes || scopes.length !== 1) {
        throw new VerificationFailedError({
            reason: 'keyAuthorization must contain a recipient-scoped transferWithMemo call',
        });
    }
    const currency = normalizeAddress(request.currency, 'currency');
    const recipient = normalizeAddress(request.recipient, 'recipient');
    const seen = new Set();
    for (const scope of scopes) {
        if (!isAddressEqual(scope.address, currency)) {
            throw new VerificationFailedError({ reason: 'keyAuthorization call target mismatch' });
        }
        const selector = normalizeSelector(scope.selector);
        if (selector !== transferSelector && selector !== transferWithMemoSelector) {
            throw new VerificationFailedError({ reason: 'keyAuthorization selector not allowed' });
        }
        if (seen.has(selector)) {
            throw new VerificationFailedError({ reason: 'keyAuthorization duplicate selector' });
        }
        seen.add(selector);
        if (scope.recipients?.length !== 1 || !isAddressEqual(scope.recipients[0], recipient)) {
            throw new VerificationFailedError({ reason: 'keyAuthorization recipient mismatch' });
        }
    }
    if (!seen.has(transferWithMemoSelector)) {
        throw new VerificationFailedError({ reason: 'keyAuthorization must allow transferWithMemo' });
    }
}
function recoverAuthorizationSource(authorization, signature) {
    const signPayload = KeyAuthorization.getSignPayload(authorization);
    try {
        const source = SignatureEnvelope.extractAddress({
            payload: signPayload,
            signature,
        });
        if (!SignatureEnvelope.verify(signature, { address: source, payload: signPayload })) {
            throw new VerificationFailedError({ reason: 'keyAuthorization signature is invalid' });
        }
        return source;
    }
    catch (error) {
        if (error instanceof VerificationFailedError)
            throw error;
        throw new VerificationFailedError({ reason: 'keyAuthorization signature is invalid' });
    }
}
function normalizeAddress(value, name) {
    if (!isAddress(value)) {
        throw new VerificationFailedError({ reason: `${name} must be an address` });
    }
    return value.toLowerCase();
}
function normalizeSelector(value) {
    if (typeof value !== 'string')
        return '';
    return value.toLowerCase();
}
//# sourceMappingURL=KeyAuthorization.js.map