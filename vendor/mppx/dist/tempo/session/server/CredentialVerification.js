import { isAddress, isAddressEqual, zeroAddress, } from 'viem';
import { AmountExceedsDepositError, ChannelClosedError, ChannelNotFoundError, DeltaTooSmallError, InsufficientBalanceError, InvalidSignatureError, VerificationFailedError, } from '../../../Errors.js';
import * as Chain from '../precompile/Chain.js';
import { readChannelClosedReceiptFields } from '../precompile/Chain.js';
import * as Channel from '../precompile/Channel.js';
import { createSessionReceipt, uint96, } from '../precompile/Protocol.js';
import * as Voucher from '../precompile/Voucher.js';
import * as ChannelStore from './ChannelStore.js';
import { getChallengePaymentFields } from './RequestState.js';
import { assertSettlementSender, getClientAccount } from './Settlement.js';
/** Returns the effective voucher signer for a TIP-1034 descriptor. */
export function authorizedSigner(descriptor) {
    return isAddressEqual(descriptor.authorizedSigner, zeroAddress)
        ? descriptor.payer
        : descriptor.authorizedSigner;
}
/** Asserts that a credential payload includes a TIP-1034 descriptor. */
export function assertDescriptor(payload) {
    if (!payload.descriptor)
        throw new VerificationFailedError({
            reason: 'descriptor required for TIP-1034 session action',
        });
}
/** Asserts that two TIP-1034 descriptors identify the same channel. */
export function assertSameDescriptor(a, b) {
    if (!isAddressEqual(a.payer, b.payer) ||
        !isAddressEqual(a.payee, b.payee) ||
        !isAddressEqual(a.operator, b.operator) ||
        !isAddressEqual(a.token, b.token) ||
        !isAddressEqual(a.authorizedSigner, b.authorizedSigner) ||
        a.salt.toLowerCase() !== b.salt.toLowerCase() ||
        a.expiringNonceHash.toLowerCase() !== b.expiringNonceHash.toLowerCase())
        throw new VerificationFailedError({
            reason: 'credential descriptor does not match stored channel',
        });
}
/**
 * Validates a TIP-1034 descriptor against channel ID, server destination, and token.
 */
export function validateChannelDescriptor(descriptor, channelId, chainId, escrow, recipient, currency, expectedOperator) {
    const computed = Channel.computeId({ ...descriptor, chainId, escrow });
    if (computed.toLowerCase() !== channelId.toLowerCase()) {
        throw new VerificationFailedError({ reason: 'channel descriptor does not match channelId' });
    }
    if (!isAddressEqual(descriptor.payee, recipient)) {
        throw new VerificationFailedError({
            reason: 'channel descriptor payee does not match server destination',
        });
    }
    if (!isAddressEqual(descriptor.token, currency)) {
        throw new VerificationFailedError({
            reason: 'channel descriptor token does not match server token',
        });
    }
    if (expectedOperator !== undefined && !isAddressEqual(descriptor.operator, expectedOperator)) {
        throw new VerificationFailedError({
            reason: 'channel descriptor operator does not match server operator',
        });
    }
}
/** Accepts the advertised fee token while preserving pre-advertisement direct clients. */
function allowedSponsoredFeeTokens(currency, feeToken) {
    if (!feeToken || isAddressEqual(feeToken, currency))
        return [currency];
    return [feeToken, currency];
}
/** Validates on-chain channel state before accepting or charging a credential. */
export function validateChannelState(state, amount) {
    if (state.deposit === 0n) {
        throw new ChannelNotFoundError({ reason: 'channel not funded on-chain' });
    }
    if (state.closeRequestedAt !== 0) {
        throw new ChannelClosedError({ reason: 'channel has a pending close request' });
    }
    if (amount !== undefined && state.deposit - state.settled < amount) {
        throw new InsufficientBalanceError({
            reason: 'channel available balance insufficient for requested amount',
        });
    }
}
/** Asserts that an opening channel covers the route's requested payment. */
export function assertOpenCredentialCoversRequest(parameters) {
    const { cumulativeAmount, openDeposit, requestAmount } = parameters;
    if (openDeposit < requestAmount)
        throw new VerificationFailedError({ reason: 'open deposit is less than request amount' });
    if (cumulativeAmount < requestAmount)
        throw new VerificationFailedError({ reason: 'voucher amount is less than request amount' });
}
/** Verifies that the credential source is authorized to spend from the channel. */
export function assertCredentialSourceCanSpend(parameters) {
    const sourceAddress = readCredentialSourceAddress(parameters.source, parameters.chainId);
    if (isAddressEqual(sourceAddress, parameters.channel.payer) ||
        isAddressEqual(sourceAddress, parameters.channel.authorizedSigner))
        return;
    throw new VerificationFailedError({
        reason: 'credential source does not match channel payer or authorized signer',
    });
}
function readCredentialSourceAddress(source, chainId) {
    const prefix = `did:pkh:eip155:${chainId}:`;
    if (!source?.startsWith(prefix))
        throw new VerificationFailedError({ reason: 'credential source does not match channel' });
    const address = source.slice(prefix.length);
    if (isAddress(address, { strict: false }))
        return address;
    throw new VerificationFailedError({ reason: 'invalid credential source' });
}
const sessionCredentialActions = [
    'open',
    'topUp',
    'voucher',
    'close',
];
const sessionCredentialActionSet = new Set(sessionCredentialActions);
function isObject(value) {
    return value !== null && typeof value === 'object';
}
function isSessionCredentialAction(value) {
    return typeof value === 'string' && sessionCredentialActionSet.has(value);
}
function isHex(value) {
    return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value);
}
function isHash(value) {
    return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}
function readAddress(value, field) {
    if (typeof value === 'string' && isAddress(value, { strict: false }))
        return value;
    throw new VerificationFailedError({ reason: `invalid session credential ${field}` });
}
function readHash(value, field) {
    if (isHash(value))
        return value;
    throw new VerificationFailedError({ reason: `invalid session credential ${field}` });
}
function readHex(value, field) {
    if (isHex(value))
        return value;
    throw new VerificationFailedError({ reason: `invalid session credential ${field}` });
}
function readRawAmount(value, field) {
    if (typeof value === 'string' && /^[0-9]+$/.test(value))
        return value;
    throw new VerificationFailedError({ reason: `invalid session credential ${field}` });
}
function readPayloadObject(payload) {
    if (!isObject(payload))
        throw new VerificationFailedError({ reason: 'invalid session credential payload' });
    return payload;
}
function readDescriptor(value) {
    if (value === undefined)
        throw new VerificationFailedError({
            reason: 'descriptor required for TIP-1034 session action',
        });
    const candidate = readPayloadObject(value);
    return {
        payer: readAddress(candidate.payer, 'descriptor.payer'),
        payee: readAddress(candidate.payee, 'descriptor.payee'),
        operator: readAddress(candidate.operator, 'descriptor.operator'),
        token: readAddress(candidate.token, 'descriptor.token'),
        salt: readHash(candidate.salt, 'descriptor.salt'),
        authorizedSigner: readAddress(candidate.authorizedSigner, 'descriptor.authorizedSigner'),
        expiringNonceHash: readHash(candidate.expiringNonceHash, 'descriptor.expiringNonceHash'),
    };
}
function readPayloadHeader(payload) {
    const candidate = readPayloadObject(payload);
    if (!isSessionCredentialAction(candidate.action)) {
        throw new VerificationFailedError({ reason: 'invalid session credential action' });
    }
    return {
        candidate,
        header: {
            action: candidate.action,
            channelId: ChannelStore.normalizeChannelId(readHash(candidate.channelId, 'channelId')),
        },
    };
}
/** Validates the action discriminator for a TIP-1034 session credential payload. */
export function requireSessionCredentialAction(payload) {
    const candidate = readPayloadObject(payload);
    if (!isSessionCredentialAction(candidate.action)) {
        throw new VerificationFailedError({ reason: 'invalid session credential action' });
    }
    return candidate.action;
}
/** Validates the shared action and channel fields for a TIP-1034 session credential payload. */
export function requireSessionCredentialPayloadHeader(payload) {
    return readPayloadHeader(payload).header;
}
/** Validates action-specific fields for a TIP-1034 session credential payload. */
export function requireSessionCredentialPayload(payload) {
    const { candidate, header } = readPayloadHeader(payload);
    switch (header.action) {
        case 'open':
            return {
                action: 'open',
                type: readTransactionType(candidate.type),
                channelId: header.channelId,
                transaction: readHex(candidate.transaction, 'transaction'),
                signature: readHex(candidate.signature, 'signature'),
                descriptor: readDescriptor(candidate.descriptor),
                cumulativeAmount: readRawAmount(candidate.cumulativeAmount, 'cumulativeAmount'),
                ...(candidate.authorizedSigner === undefined
                    ? {}
                    : {
                        authorizedSigner: readAddress(candidate.authorizedSigner, 'authorizedSigner'),
                    }),
            };
        case 'topUp':
            return {
                action: 'topUp',
                type: readTransactionType(candidate.type),
                channelId: header.channelId,
                transaction: readHex(candidate.transaction, 'transaction'),
                descriptor: readDescriptor(candidate.descriptor),
                additionalDeposit: readRawAmount(candidate.additionalDeposit, 'additionalDeposit'),
            };
        case 'voucher':
            return {
                action: 'voucher',
                channelId: header.channelId,
                descriptor: readDescriptor(candidate.descriptor),
                cumulativeAmount: readRawAmount(candidate.cumulativeAmount, 'cumulativeAmount'),
                signature: readHex(candidate.signature, 'signature'),
            };
        case 'close':
            return {
                action: 'close',
                channelId: header.channelId,
                descriptor: readDescriptor(candidate.descriptor),
                cumulativeAmount: readRawAmount(candidate.cumulativeAmount, 'cumulativeAmount'),
                signature: readHex(candidate.signature, 'signature'),
            };
    }
}
function readTransactionType(value) {
    if (value === 'transaction')
        return value;
    throw new VerificationFailedError({ reason: 'invalid session credential transaction type' });
}
const refreshOnChainVerificationCache = {
    close: false,
    open: true,
    topUp: true,
    voucher: false,
};
/** Validates all action-specific session credential invariants without changing payment state. */
export async function validateCredentialPayload(parameters) {
    const { payload } = parameters;
    switch (payload.action) {
        case 'open':
            await validateOpenCredential(parameters, payload);
            break;
        case 'topUp':
            await validateTopUpCredential(parameters, payload);
            break;
        case 'voucher':
            await validateVoucherCredential(parameters, payload);
            break;
        case 'close':
            await validateCloseCredential(parameters, payload);
            break;
    }
    return { action: payload.action, channelId: ChannelStore.normalizeChannelId(payload.channelId) };
}
async function validateOpenCredential(parameters, payload) {
    const { challenge, chainId, client, escrow } = parameters;
    const request = getChallengePaymentFields(challenge);
    const expectedOperator = parameters.expectedOperator ?? zeroAddress;
    const cumulativeAmount = uint96(BigInt(payload.cumulativeAmount));
    assertDescriptor(payload);
    if (payload.authorizedSigner !== undefined &&
        !isAddressEqual(payload.authorizedSigner, payload.descriptor.authorizedSigner))
        throw new VerificationFailedError({
            reason: 'credential authorizedSigner does not match descriptor',
        });
    const channelId = ChannelStore.normalizeChannelId(payload.channelId);
    validateChannelDescriptor(payload.descriptor, channelId, chainId, escrow, request.recipient, request.currency, expectedOperator);
    const transaction = Chain.validateOpenCredentialTransaction({
        allowedFeeTokens: allowedSponsoredFeeTokens(request.currency, parameters.feeToken),
        challengeExpires: challenge.expires,
        chainId,
        escrowContract: escrow,
        expectedAuthorizedSigner: payload.descriptor.authorizedSigner,
        expectedChannelId: channelId,
        expectedCurrency: request.currency,
        expectedOperator,
        expectedPayee: request.recipient,
        expectedExpiringNonceHash: payload.descriptor.expiringNonceHash,
        expectedPayer: payload.descriptor.payer,
        feePayer: parameters.feePayer,
        feePayerPolicy: parameters.feePayerPolicy,
        serializedTransaction: payload.transaction,
    });
    assertOpenCredentialCoversRequest({
        cumulativeAmount,
        openDeposit: transaction.openDeposit,
        requestAmount: request.amount,
    });
    assertSameDescriptor(transaction.descriptor, payload.descriptor);
    if (cumulativeAmount > transaction.openDeposit)
        throw new AmountExceedsDepositError({ reason: 'voucher amount exceeds open deposit' });
    const valid = await Voucher.verifyVoucher(escrow, chainId, { channelId, cumulativeAmount, signature: payload.signature }, authorizedSigner(transaction.descriptor));
    if (!valid)
        throw new InvalidSignatureError({ reason: 'invalid voucher signature' });
    await Chain.simulateCredentialTransaction({
        client,
        feePayer: parameters.feePayer,
        transaction: transaction.transaction,
    });
}
async function validateTopUpCredential(parameters, payload) {
    const { challenge, chainId, client, escrow, store } = parameters;
    const request = getChallengePaymentFields(challenge);
    const expectedOperator = parameters.expectedOperator ?? zeroAddress;
    const additionalDeposit = uint96(BigInt(payload.additionalDeposit));
    assertDescriptor(payload);
    const channelId = ChannelStore.normalizeChannelId(payload.channelId);
    validateChannelDescriptor(payload.descriptor, channelId, chainId, escrow, request.recipient, request.currency, expectedOperator);
    const channel = await ChannelStore.loadPrecompileChannel({
        descriptor: payload.descriptor,
        channelId,
        chainId,
        escrow,
        store,
        validateDescriptor: true,
    });
    const transaction = Chain.validateTopUpCredentialTransaction({
        additionalDeposit,
        allowedFeeTokens: allowedSponsoredFeeTokens(request.currency, parameters.feeToken),
        challengeExpires: challenge.expires,
        chainId,
        descriptor: channel.descriptor,
        escrowContract: escrow,
        expectedChannelId: channelId,
        expectedCurrency: request.currency,
        feePayer: parameters.feePayer,
        feePayerPolicy: parameters.feePayerPolicy,
        serializedTransaction: payload.transaction,
    });
    validateChannelState(await Chain.getChannelState(client, channelId, escrow));
    await Chain.simulateCredentialTransaction({
        client,
        feePayer: parameters.feePayer,
        transaction: transaction.transaction,
    });
}
async function validateVoucherCredential(parameters, payload) {
    const { challenge, chainId, client, credentialSource, escrow, minVoucherDelta, store, channelStateTtl, lastOnChainVerified, } = parameters;
    const request = getChallengePaymentFields(challenge);
    const expectedOperator = parameters.expectedOperator ?? zeroAddress;
    const channelId = ChannelStore.normalizeChannelId(payload.channelId);
    const voucher = Voucher.parseVoucherFromPayload(channelId, payload.cumulativeAmount, payload.signature);
    assertDescriptor(payload);
    validateChannelDescriptor(payload.descriptor, channelId, chainId, escrow, request.recipient, request.currency, expectedOperator);
    const channel = await ChannelStore.loadPrecompileChannel({
        descriptor: payload.descriptor,
        channelId,
        chainId,
        escrow,
        store,
        validateDescriptor: true,
    });
    assertCredentialSourceCanSpend({ chainId, channel, source: credentialSource });
    if (channel.finalized)
        throw new ChannelClosedError({ reason: 'channel is finalized' });
    const channelState = await resolveVoucherChannelState({
        channel,
        channelId,
        channelStateTtl,
        client,
        escrow,
        lastOnChainVerified,
    });
    await ChannelStore.validateVoucher({
        channel,
        channelState,
        methodDetails: { chainId, escrowContract: escrow },
        minVoucherDelta,
        voucher,
    });
}
async function resolveVoucherChannelState(parameters) {
    const { channel, channelId, channelStateTtl, client, escrow, lastOnChainVerified } = parameters;
    const isStale = Date.now() - (lastOnChainVerified.get(channelId) ?? 0) > channelStateTtl;
    const state = isStale ? await Chain.getChannelState(client, channelId, escrow) : undefined;
    if (state)
        lastOnChainVerified.set(channelId, Date.now());
    return {
        deposit: state?.deposit ?? uint96(channel.deposit),
        settled: state?.settled ?? uint96(channel.settledOnChain),
        closeRequestedAt: state?.closeRequestedAt ?? Number(channel.closeRequestedAt),
    };
}
async function validateCloseCredential(parameters, payload) {
    const { challenge, chainId, client, escrow, store } = parameters;
    const request = getChallengePaymentFields(challenge);
    const expectedOperator = parameters.expectedOperator ?? zeroAddress;
    const cumulativeAmount = uint96(BigInt(payload.cumulativeAmount));
    const channelId = ChannelStore.normalizeChannelId(payload.channelId);
    assertDescriptor(payload);
    validateChannelDescriptor(payload.descriptor, channelId, chainId, escrow, request.recipient, request.currency, expectedOperator);
    const channel = await ChannelStore.loadPrecompileChannel({
        descriptor: payload.descriptor,
        channelId,
        chainId,
        escrow,
        store,
    });
    if (channel.finalized)
        throw new ChannelClosedError({ reason: 'channel is already finalized' });
    const state = await Chain.getChannelState(client, channelId, escrow);
    if (state.closeRequestedAt !== 0)
        throw new ChannelClosedError({ reason: 'channel has a pending close request' });
    if (state.deposit === 0n && (cumulativeAmount !== 0n || channel.spent !== 0n))
        throw new ChannelClosedError({ reason: 'channel deposit is zero (settled)' });
    if (cumulativeAmount < channel.spent)
        throw new VerificationFailedError({
            reason: `close voucher amount must be >= ${channel.spent} (spent)`,
        });
    if (cumulativeAmount < state.settled)
        throw new VerificationFailedError({
            reason: `close voucher amount must be >= ${state.settled} (on-chain settled)`,
        });
    const valid = await Voucher.verifyVoucher(escrow, chainId, { channelId, cumulativeAmount, signature: payload.signature }, channel.authorizedSigner);
    if (!valid)
        throw new InvalidSignatureError({ reason: 'invalid voucher signature' });
    const captureAmount = uint96(channel.spent > state.settled ? channel.spent : state.settled);
    if (captureAmount > state.deposit)
        throw new AmountExceedsDepositError({ reason: 'close capture amount exceeds on-chain deposit' });
    const account = parameters.account ?? getClientAccount(client);
    assertSettlementSender({
        operation: 'close',
        channelId,
        operator: channel.operator,
        payee: channel.payee,
        sender: account?.address,
    });
}
/** Broadcasts a validated session credential payload and applies its state transition. */
export async function broadcastCredentialPayload(context) {
    const receipt = await broadcastCredentialAction(context);
    if (refreshOnChainVerificationCache[context.payload.action])
        context.lastOnChainVerified.set(receipt.channelId, Date.now());
    return receipt;
}
/** @deprecated Use {@link broadcastCredentialPayload}. */
export async function verifyCredentialPayload(context) {
    return broadcastCredentialPayload(context);
}
function broadcastCredentialAction(context) {
    const { payload } = context;
    switch (payload.action) {
        case 'open':
            return handleOpenCredential(actionContext(context, payload));
        case 'topUp':
            return handleTopUpCredential(actionContext(context, payload));
        case 'voucher':
            return handleVoucherCredential(actionContext(context, payload));
        case 'close':
            return handleCloseCredential(actionContext(context, payload));
    }
}
function actionContext(context, payload) {
    return { ...context, payload };
}
async function handleOpenCredential(parameters) {
    const { store, client, challenge, payload, chainId, escrow } = parameters;
    const request = getChallengePaymentFields(challenge);
    const expectedOperator = parameters.expectedOperator ?? zeroAddress;
    const cumulativeAmount = uint96(BigInt(payload.cumulativeAmount));
    assertDescriptor(payload);
    if (payload.authorizedSigner !== undefined &&
        !isAddressEqual(payload.authorizedSigner, payload.descriptor.authorizedSigner))
        throw new VerificationFailedError({
            reason: 'credential authorizedSigner does not match descriptor',
        });
    const channelId = ChannelStore.normalizeChannelId(payload.channelId);
    validateChannelDescriptor(payload.descriptor, channelId, chainId, escrow, request.recipient, request.currency, expectedOperator);
    const result = await Chain.broadcastOpenTransaction({
        allowedFeeTokens: allowedSponsoredFeeTokens(request.currency, parameters.feeToken),
        challengeExpires: challenge.expires,
        chainId,
        client,
        escrowContract: escrow,
        expectedAuthorizedSigner: payload.descriptor.authorizedSigner,
        expectedChannelId: channelId,
        expectedCurrency: request.currency,
        expectedOperator,
        expectedPayee: request.recipient,
        expectedExpiringNonceHash: payload.descriptor.expiringNonceHash,
        expectedPayer: payload.descriptor.payer,
        feePayer: parameters.feePayer,
        feePayerPolicy: parameters.feePayerPolicy,
        serializedTransaction: payload.transaction,
        async beforeBroadcast(prepared) {
            assertOpenCredentialCoversRequest({
                cumulativeAmount,
                openDeposit: prepared.openDeposit,
                requestAmount: request.amount,
            });
            assertSameDescriptor(prepared.descriptor, payload.descriptor);
            if (cumulativeAmount > prepared.openDeposit)
                throw new AmountExceedsDepositError({ reason: 'voucher amount exceeds open deposit' });
            const valid = await Voucher.verifyVoucher(escrow, chainId, { channelId, cumulativeAmount: cumulativeAmount, signature: payload.signature }, authorizedSigner(prepared.descriptor));
            if (!valid)
                throw new InvalidSignatureError({ reason: 'invalid voucher signature' });
        },
    });
    const { descriptor, state } = result;
    assertSameDescriptor(descriptor, payload.descriptor);
    validateChannelState(state, request.amount);
    const updated = await store.updateChannel(channelId, (current) => {
        if (parameters.requireVoucherAdvance &&
            current !== null &&
            cumulativeAmount <= current.highestVoucherAmount)
            throw new DeltaTooSmallError({
                reason: 'voucher does not add new funds for this request',
            });
        return ChannelStore.openChannelState({
            authorizedSigner: authorizedSigner(descriptor),
            chainId,
            channelId,
            current,
            descriptor,
            escrow,
            expiringNonceHash: result.expiringNonceHash,
            cumulativeAmount,
            signature: payload.signature,
            state,
        });
    });
    if (!updated)
        throw new VerificationFailedError({ reason: 'failed to create channel' });
    return createSessionReceipt({
        challengeId: challenge.id,
        channelId,
        acceptedCumulative: updated.highestVoucherAmount,
        spent: updated.spent,
        units: updated.units,
        txHash: result.txHash,
    });
}
async function handleTopUpCredential(parameters) {
    const { store, client, challenge, payload, chainId, escrow } = parameters;
    const request = getChallengePaymentFields(challenge);
    const expectedOperator = parameters.expectedOperator ?? zeroAddress;
    const additionalDeposit = uint96(BigInt(payload.additionalDeposit));
    assertDescriptor(payload);
    const channelId = ChannelStore.normalizeChannelId(payload.channelId);
    validateChannelDescriptor(payload.descriptor, channelId, chainId, escrow, request.recipient, request.currency, expectedOperator);
    const channel = await ChannelStore.loadPrecompileChannel({
        descriptor: payload.descriptor,
        channelId,
        chainId,
        escrow,
        store,
        validateDescriptor: true,
    });
    const result = await Chain.broadcastTopUpTransaction({
        additionalDeposit,
        allowedFeeTokens: allowedSponsoredFeeTokens(request.currency, parameters.feeToken),
        challengeExpires: challenge.expires,
        chainId,
        client,
        descriptor: channel.descriptor,
        escrowContract: escrow,
        expectedChannelId: channelId,
        expectedCurrency: request.currency,
        feePayer: parameters.feePayer,
        feePayerPolicy: parameters.feePayerPolicy,
        serializedTransaction: payload.transaction,
    });
    const { state } = result;
    validateChannelState(state);
    const updated = await store.updateChannel(channelId, (current) => ChannelStore.topUpChannelState({ current, state }));
    return createSessionReceipt({
        challengeId: challenge.id,
        channelId,
        acceptedCumulative: updated?.highestVoucherAmount ?? channel.highestVoucherAmount,
        spent: updated?.spent ?? channel.spent,
        units: updated?.units ?? channel.units,
        txHash: result.txHash,
    });
}
async function handleVoucherCredential(parameters) {
    const { store, client, challenge, credentialSource, payload, chainId, escrow, minVoucherDelta, channelStateTtl, lastOnChainVerified, } = parameters;
    const request = getChallengePaymentFields(challenge);
    const expectedOperator = parameters.expectedOperator ?? zeroAddress;
    const channelId = ChannelStore.normalizeChannelId(payload.channelId);
    const voucher = Voucher.parseVoucherFromPayload(channelId, payload.cumulativeAmount, payload.signature);
    assertDescriptor(payload);
    validateChannelDescriptor(payload.descriptor, channelId, chainId, escrow, request.recipient, request.currency, expectedOperator);
    const channel = await ChannelStore.loadPrecompileChannel({
        descriptor: payload.descriptor,
        channelId,
        chainId,
        escrow,
        store,
        validateDescriptor: true,
    });
    assertCredentialSourceCanSpend({ chainId, channel, source: credentialSource });
    if (channel.finalized)
        throw new ChannelClosedError({ reason: 'channel is finalized' });
    const channelState = await resolveVoucherChannelState({
        channel,
        channelId,
        channelStateTtl,
        client,
        escrow,
        lastOnChainVerified,
    });
    if (channelState.closeRequestedAt !== 0) {
        await store.updateChannel(channelId, (current) => current
            ? {
                ...current,
                closeRequestedAt: BigInt(channelState.closeRequestedAt) > current.closeRequestedAt
                    ? BigInt(channelState.closeRequestedAt)
                    : current.closeRequestedAt,
            }
            : current);
    }
    return ChannelStore.verifyAndAcceptVoucher({
        store,
        minVoucherDelta,
        requireAdvance: parameters.requireVoucherAdvance,
        challenge,
        channel,
        voucher,
        channelState,
        methodDetails: { chainId, escrowContract: escrow },
    });
}
async function handleCloseCredential(parameters) {
    const { store, client, challenge, payload, chainId, escrow } = parameters;
    const request = getChallengePaymentFields(challenge);
    const expectedOperator = parameters.expectedOperator ?? zeroAddress;
    const cumulativeAmount = uint96(BigInt(payload.cumulativeAmount));
    const channelId = ChannelStore.normalizeChannelId(payload.channelId);
    assertDescriptor(payload);
    validateChannelDescriptor(payload.descriptor, channelId, chainId, escrow, request.recipient, request.currency, expectedOperator);
    const channel = await ChannelStore.loadPrecompileChannel({
        descriptor: payload.descriptor,
        channelId,
        chainId,
        escrow,
        store,
    });
    if (channel.finalized)
        throw new ChannelClosedError({ reason: 'channel is already finalized' });
    const state = await Chain.getChannelState(client, channelId, escrow);
    if (state.closeRequestedAt !== 0)
        throw new ChannelClosedError({ reason: 'channel has a pending close request' });
    if (state.deposit === 0n && (cumulativeAmount !== 0n || channel.spent !== 0n))
        throw new ChannelClosedError({ reason: 'channel deposit is zero (settled)' });
    if (cumulativeAmount < channel.spent)
        throw new VerificationFailedError({
            reason: `close voucher amount must be >= ${channel.spent} (spent)`,
        });
    if (cumulativeAmount < state.settled)
        throw new VerificationFailedError({
            reason: `close voucher amount must be >= ${state.settled} (on-chain settled)`,
        });
    const valid = await Voucher.verifyVoucher(escrow, chainId, { channelId, cumulativeAmount: cumulativeAmount, signature: payload.signature }, channel.authorizedSigner);
    if (!valid)
        throw new InvalidSignatureError({ reason: 'invalid voucher signature' });
    let captureAmount = uint96(channel.spent > state.settled ? channel.spent : state.settled);
    if (captureAmount > state.deposit)
        throw new AmountExceedsDepositError({ reason: 'close capture amount exceeds on-chain deposit' });
    const pendingCloseStartedAt = BigInt(Math.floor(Date.now() / 1000) || 1);
    const previousCloseRequestedAt = channel.closeRequestedAt;
    let pendingCloseMarked = false;
    await store.updateChannel(channelId, (current) => {
        const next = ChannelStore.markPendingClose({
            closeRequestedAt: pendingCloseStartedAt,
            cumulativeAmount,
            current,
            onChainDeposit: state.deposit,
            onChainSettled: state.settled,
        });
        if (next.state) {
            captureAmount = next.captureAmount;
            pendingCloseMarked = true;
        }
        return next.state;
    });
    const account = parameters.account ?? getClientAccount(client);
    let txHash;
    let receipt;
    try {
        assertSettlementSender({
            operation: 'close',
            channelId,
            operator: channel.operator,
            payee: channel.payee,
            sender: account?.address,
        });
        txHash = await Chain.closeOnChain(client, channel.descriptor, cumulativeAmount, captureAmount, payload.signature, escrow, account
            ? {
                account,
                ...(parameters.feePayer ? { feePayer: parameters.feePayer } : {}),
                ...(parameters.feePayerPolicy ? { feePayerPolicy: parameters.feePayerPolicy } : {}),
                ...(parameters.feeToken ? { feeToken: parameters.feeToken } : {}),
                candidateFeeTokens: [channel.token],
            }
            : undefined);
        receipt = await Chain.waitForSuccessfulReceipt(client, txHash);
    }
    catch (error) {
        if (pendingCloseMarked) {
            await store.updateChannel(channelId, (current) => current && current.closeRequestedAt === pendingCloseStartedAt
                ? { ...current, closeRequestedAt: previousCloseRequestedAt }
                : current);
        }
        throw error;
    }
    const closed = readChannelClosedReceiptFields(Chain.getChannelEvent(receipt, 'ChannelClosed', channelId));
    const { refundedToPayer, settledToPayee } = closed;
    if (settledToPayee > captureAmount || settledToPayee + refundedToPayer > state.deposit)
        throw new VerificationFailedError({ reason: 'ChannelClosed amounts do not match state' });
    const updated = await store.updateChannel(channelId, (current) => ChannelStore.finalizeClosedChannelState({
        captureAmount,
        channelId,
        cumulativeAmount,
        current,
        signature: payload.signature,
    }));
    if (parameters.onSessionSettlement && txHash) {
        try {
            await parameters.onSessionSettlement(Object.freeze({
                txHash,
                channelId,
                trigger: 'close',
                amount: settledToPayee,
                delta: settledToPayee - state.settled,
            }));
        }
        catch {
            // Errors are isolated — observers cannot break the settlement flow.
        }
    }
    return createSessionReceipt({
        challengeId: challenge.id,
        channelId,
        acceptedCumulative: cumulativeAmount,
        spent: updated?.spent ?? channel.spent,
        units: updated?.units ?? channel.units,
        txHash,
    });
}
//# sourceMappingURL=CredentialVerification.js.map