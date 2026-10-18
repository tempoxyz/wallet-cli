import { isAddress, isAddressEqual, parseUnits, } from 'viem';
import * as Constants from '../../../Constants.js';
import { VerificationFailedError } from '../../../Errors.js';
import * as Methods from '../../Methods.js';
import { captureRequestBodyProbe, isSessionContentRequest, } from '../../server/internal/request-body.js';
import { tip20ChannelEscrow } from '../precompile/Protocol.js';
import * as ChannelStore from './ChannelStore.js';
import { requireSessionCredentialAction } from './CredentialVerification.js';
import { resolveCredentialFeePayer, resolveRequestFeePayer, } from './Settlement.js';
/** Normalizes a session channel ID hint when one is present. */
export function normalizeSessionChannelId(value) {
    if (typeof value !== 'string')
        return undefined;
    try {
        return ChannelStore.normalizeChannelId(value);
    }
    catch {
        return undefined;
    }
}
/** Extracts and normalizes a credential channel ID after credential verification. */
export function getCredentialChannelId(credential) {
    if (!isObject(credential?.payload))
        return undefined;
    return normalizeSessionChannelId(credential.payload.channelId);
}
function normalizeResolvedSessionChannelId(value) {
    if (value === null || value === undefined)
        return undefined;
    return ChannelStore.normalizeChannelId(value);
}
/** Resolves the channel ID used to build server-side session bootstrap hints. */
export async function resolveSessionChannelId(parameters) {
    const { capturedRequest, credential, request, resolveChannelId, source, store } = parameters;
    const explicitChannelId = normalizeSessionChannelId(request.channelId);
    if (explicitChannelId)
        return explicitChannelId;
    if (!resolveChannelId)
        return undefined;
    return normalizeResolvedSessionChannelId(await resolveChannelId({
        request: capturedRequest,
        credential: source ? credential : null,
        source,
        paymentRequest: request,
        store,
    }));
}
/** Builds server bootstrap hints for a reusable precompile session channel. */
export async function resolveSessionSnapshot(parameters) {
    const { amount, channelId, expected, minimumVoucherAdvance = 0n, requireVoucherAdvance = false, store, } = parameters;
    if (!channelId)
        return undefined;
    const channel = await store.getChannel(ChannelStore.normalizeChannelId(channelId));
    if (!channel || !ChannelStore.isPrecompileState(channel))
        return undefined;
    if (channel.finalized)
        return undefined;
    if (channel.closeRequestedAt !== 0n)
        return undefined;
    if (!channel.highestVoucher)
        return undefined;
    if (channel.highestVoucher.cumulativeAmount !== channel.highestVoucherAmount)
        return undefined;
    if (expected && !matchesSnapshotPaymentFields(channel, expected))
        return undefined;
    const spendBoundary = channel.spent + amount;
    const advanceBoundary = requireVoucherAdvance
        ? channel.highestVoucherAmount + (minimumVoucherAdvance > 0n ? minimumVoucherAdvance : 1n)
        : 0n;
    const requiredCumulative = spendBoundary > advanceBoundary ? spendBoundary : advanceBoundary;
    return {
        acceptedCumulative: channel.highestVoucherAmount.toString(),
        chainId: channel.chainId,
        channelId: channel.channelId,
        closeRequestedAt: undefined,
        deposit: channel.deposit.toString(),
        descriptor: channel.descriptor,
        escrow: channel.escrowContract,
        highestVoucher: {
            channelId: channel.highestVoucher.channelId,
            cumulativeAmount: channel.highestVoucher.cumulativeAmount.toString(),
            signature: channel.highestVoucher.signature,
        },
        requiredCumulative: requiredCumulative.toString(),
        settled: channel.settledOnChain.toString(),
        spent: channel.spent.toString(),
        units: channel.units,
    };
}
function matchesSnapshotPaymentFields(channel, expected) {
    return (channel.chainId === expected.chainId &&
        isAddressEqual(channel.escrowContract, expected.escrowContract) &&
        isAddressEqual(channel.payee, expected.recipient) &&
        isAddressEqual(channel.token, expected.currency));
}
/**
 * Returns a management response for non-content session actions.
 *
 * `close` and `topUp` are always management-only. `open` and `voucher` serve
 * content only when the request classifier says the request is billable.
 */
export function respondToSessionCredential(parameters) {
    const action = requireSessionCredentialAction(parameters.payload);
    if (action === 'close')
        return new Response(null, { status: 204 });
    if (action === 'topUp')
        return new Response(null, { status: 204 });
    const request = parameters.capturedRequest ?? captureRequestBodyProbe(parameters.input);
    if (isSessionContentRequest(request))
        return undefined;
    return new Response(null, { status: 204 });
}
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
function isCanonicalSessionMethodDetails(value) {
    return (isObject(value) &&
        typeof value.chainId === 'number' &&
        typeof value.escrowContract === 'string' &&
        isAddress(value.escrowContract, { strict: false }) &&
        (value.feePayer === undefined || typeof value.feePayer === 'boolean') &&
        (value.feeToken === undefined ||
            (typeof value.feeToken === 'string' && isAddress(value.feeToken, { strict: false }))) &&
        (value.minVoucherDelta === undefined || typeof value.minVoucherDelta === 'string') &&
        (value.operator === undefined ||
            (typeof value.operator === 'string' && isAddress(value.operator, { strict: false }))) &&
        (value.sessionProtocol === undefined || value.sessionProtocol === Constants.SessionProtocols.v2));
}
function isVerifiedSessionPaymentRequest(request) {
    return (isObject(request) &&
        typeof request.amount === 'string' &&
        typeof request.currency === 'string' &&
        typeof request.unitType === 'string' &&
        isCanonicalSessionMethodDetails(request.methodDetails));
}
function readChallengeAddress(value, label) {
    if (typeof value === 'string' && isAddress(value, { strict: false }))
        return value;
    throw new VerificationFailedError({ reason: `missing challenge ${label}` });
}
function readChallengeAmount(value) {
    if (typeof value === 'string')
        return BigInt(value);
    throw new VerificationFailedError({ reason: 'missing challenge amount' });
}
/** Reads the destination, token, and raw amount from a session challenge request. */
export function getChallengePaymentFields(challenge) {
    return {
        amount: readChallengeAmount(challenge.request.amount),
        currency: readChallengeAddress(challenge.request.currency, 'currency'),
        recipient: readChallengeAddress(challenge.request.recipient, 'recipient'),
    };
}
/** Resolves the chain ID from request override, method parameters, or client config. */
export async function resolveRequestChainId(parameters) {
    const { getClient, parameterChainId, requestChainId } = parameters;
    if (requestChainId)
        return requestChainId;
    if (parameterChainId)
        return parameterChainId;
    return (await getClient({})).chain?.id;
}
/** Resolves request-time TIP-1034 details and server bootstrap hints for a challenge. */
export async function resolveSessionPaymentRequest(parameters) {
    const { capturedRequest, credential, decimals, defaultFeePayer, getClient, minVoucherDelta, parameterChainId, parameterEscrowContract, parameterFeePayer, request, resolveChannelId, source, sseEnabled, store, } = parameters;
    const chainId = await resolveRequestChainId({
        getClient,
        parameterChainId,
        requestChainId: request.chainId,
    });
    if (!chainId)
        throw new Error('No chainId configured for tempo.session().');
    const client = await getClient({ chainId });
    if (client.chain?.id !== chainId)
        throw new Error(`Client not configured with chainId ${chainId}.`);
    const escrowContract = resolveRequestEscrowContract(request.escrowContract, parameterEscrowContract);
    const operator = resolveRequestOperator(request.operator);
    const requestAmount = parseUnits(request.amount, decimals);
    const isContentRequest = capturedRequest ? isSessionContentRequest(capturedRequest) : false;
    const channelId = await resolveSessionChannelId({
        capturedRequest,
        credential,
        request,
        resolveChannelId,
        source,
        store,
    });
    const sessionSnapshot = await resolveSessionSnapshot({
        amount: capturedRequest && !isContentRequest ? 0n : requestAmount,
        channelId,
        expected: {
            chainId,
            currency: readChallengeAddress(request.currency, 'currency'),
            escrowContract,
            recipient: readChallengeAddress(request.recipient, 'recipient'),
        },
        minimumVoucherAdvance: parseUnits(minVoucherDelta ?? '0', decimals),
        requireVoucherAdvance: Boolean(capturedRequest) && !sseEnabled && isContentRequest,
        store,
    });
    const { operator: _operator, ...requestWithoutOperator } = request;
    return {
        ...requestWithoutOperator,
        chainId,
        escrowContract,
        feePayer: resolveRequestFeePayer({
            credential,
            defaultFeePayer,
            parameterFeePayer,
            requestFeePayer: request.feePayer,
        }),
        ...(operator ? { operator } : {}),
        ...(sessionSnapshot ? { sessionSnapshot } : {}),
    };
}
function resolveRequestEscrowContract(requestEscrowContract, parameterEscrowContract) {
    if (typeof requestEscrowContract === 'string') {
        if (!isAddress(requestEscrowContract, { strict: false }))
            throw new Error('Invalid escrowContract configured for tempo.session().');
        return requestEscrowContract;
    }
    return parameterEscrowContract ?? tip20ChannelEscrow;
}
function resolveRequestOperator(requestOperator) {
    if (requestOperator === undefined)
        return undefined;
    if (typeof requestOperator === 'string' && isAddress(requestOperator, { strict: false }))
        return requestOperator;
    throw new Error('Invalid operator configured for tempo.session().');
}
/** Parses the canonical session request shape used during credential verification. */
export function resolveVerificationRequest(request) {
    const parsed = Methods.session.schema.request.safeParse(request);
    if (parsed.success && isVerifiedSessionPaymentRequest(parsed.data))
        return parsed.data;
    // verifyCredential() passes the HMAC-bound challenge request, which is
    // already in canonical output form and should not be transformed again.
    if (isVerifiedSessionPaymentRequest(request))
        return request;
    throw new VerificationFailedError({ reason: 'invalid session request' });
}
/** Returns required TIP-1034 method details from a canonical session request. */
export function requireMethodDetails(request) {
    return request.methodDetails;
}
/** Resolves all non-payload verification context from a session challenge request. */
export async function resolveCredentialVerificationContext(parameters) {
    const { decimals, feePayer, getClient, minVoucherDelta, request } = parameters;
    const resolvedRequest = resolveVerificationRequest(request);
    const methodDetails = requireMethodDetails(resolvedRequest);
    const chainId = methodDetails.chainId;
    const client = await getClient({ chainId });
    return {
        request: resolvedRequest,
        methodDetails,
        chainId,
        escrow: methodDetails.escrowContract,
        client,
        feePayer: resolveCredentialFeePayer({
            feePayer,
            methodDetails,
            request: resolvedRequest,
        }),
        minVoucherDelta: methodDetails.minVoucherDelta
            ? BigInt(methodDetails.minVoucherDelta)
            : parseUnits(minVoucherDelta ?? '0', decimals),
    };
}
//# sourceMappingURL=RequestState.js.map