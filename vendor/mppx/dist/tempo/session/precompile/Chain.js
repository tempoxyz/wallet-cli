import { decodeFunctionData, encodeFunctionData, isAddressEqual, parseEventLogs } from 'viem';
import { call, prepareTransactionRequest, readContract, sendRawTransaction, sendRawTransactionSync, sendTransaction as sendViemTransaction, signTransaction, waitForTransactionReceipt, } from 'viem/actions';
import { Abis, Addresses, Transaction } from 'viem/tempo';
import { BadRequestError, VerificationFailedError } from '../../../Errors.js';
import * as FeePayer from '../../internal/fee-payer.js';
import { resolveFeeToken } from '../../internal/fee-token.js';
import * as ChannelOps from '../server/ChannelOps.js';
import * as ChannelUtils from './Channel.js';
import { escrowAbi } from './escrow.abi.js';
import { tip20ChannelEscrow } from './Protocol.js';
const uint96Max = 2n ** 96n - 1n;
function readBytes32(value, label) {
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value))
        return value;
    throw new VerificationFailedError({ reason: `${label} missing from receipt event` });
}
function readUint96(value, label) {
    if (typeof value !== 'bigint')
        throw new VerificationFailedError({ reason: `${label} missing from receipt event` });
    if (value < 0n || value > uint96Max)
        throw new VerificationFailedError({ reason: `${label} exceeds uint96 range` });
    return value;
}
/** Reads and validates typed fields from a ChannelOpened receipt event. */
export function readChannelOpenedReceiptFields(event) {
    return {
        channelId: readBytes32(event.args.channelId, 'ChannelOpened channelId'),
        deposit: readUint96(event.args.deposit, 'ChannelOpened deposit'),
        expiringNonceHash: readBytes32(event.args.expiringNonceHash, 'ChannelOpened expiringNonceHash'),
    };
}
/** Reads and validates typed fields from a TopUp receipt event. */
export function readTopUpReceiptFields(event) {
    return {
        channelId: readBytes32(event.args.channelId, 'TopUp channelId'),
        newDeposit: readUint96(event.args.newDeposit, 'TopUp newDeposit'),
    };
}
/** Reads and validates typed fields from a Settled receipt event. */
export function readSettledReceiptFields(event) {
    return {
        newSettled: readUint96(event.args.newSettled, 'Settled newSettled'),
    };
}
/** Reads and validates typed fields from a ChannelClosed receipt event. */
export function readChannelClosedReceiptFields(event) {
    return {
        settledToPayee: readUint96(event.args.settledToPayee, 'ChannelClosed settledToPayee'),
        refundedToPayer: readUint96(event.args.refundedToPayer, 'ChannelClosed refundedToPayer'),
    };
}
/** Validates that ChannelOpened receipt fields match calldata, descriptor, and credential. */
export function validateChannelOpenedReceipt(parameters) {
    const { chainId, descriptor, emittedChannelId, emittedDeposit, emittedExpiringNonceHash, escrow, expectedChannelId, openDeposit, } = parameters;
    if (emittedChannelId.toLowerCase() !== expectedChannelId.toLowerCase())
        throw new VerificationFailedError({
            reason: 'ChannelOpened channelId does not match credential',
        });
    if (emittedExpiringNonceHash.toLowerCase() !== descriptor.expiringNonceHash.toLowerCase())
        throw new VerificationFailedError({
            reason: 'ChannelOpened expiringNonceHash does not match descriptor',
        });
    if (emittedDeposit !== openDeposit)
        throw new VerificationFailedError({ reason: 'ChannelOpened deposit does not match calldata' });
    const confirmedChannelId = ChannelUtils.computeId({ ...descriptor, chainId, escrow });
    if (confirmedChannelId.toLowerCase() !== emittedChannelId.toLowerCase())
        throw new VerificationFailedError({
            reason: 'descriptor does not match ChannelOpened channelId',
        });
}
/** Validates the state read back after a successful open transaction. */
export function validateOpenReadbackState(parameters) {
    const { emittedDeposit, state } = parameters;
    if (state.deposit !== emittedDeposit || state.settled !== 0n || state.closeRequestedAt !== 0)
        throw new VerificationFailedError({
            reason: 'on-chain channel state does not match open receipt',
        });
}
/** Validates that a TopUp receipt belongs to the credential channel. */
export function validateTopUpReceipt(parameters) {
    if (parameters.emittedChannelId.toLowerCase() !== parameters.expectedChannelId.toLowerCase())
        throw new VerificationFailedError({ reason: 'TopUp channelId does not match credential' });
}
/** Validates the state read back after a successful top-up transaction. */
export function validateTopUpReadbackState(parameters) {
    if (parameters.state.deposit !== parameters.newDeposit)
        throw new VerificationFailedError({
            reason: 'on-chain channel state does not match topUp receipt',
        });
}
/** Enforces sponsor gas and fee limits before co-signing a direct precompile call. */
export function assertPrecompileFeePayerPolicy(parameters) {
    const { policy, prepared } = parameters;
    if (!policy)
        return;
    if (policy.maxGas !== undefined && (prepared.gas ?? 0n) > policy.maxGas)
        throw new BadRequestError({ reason: 'fee-payer policy maxGas exceeded' });
    if (policy.maxFeePerGas !== undefined && (prepared.maxFeePerGas ?? 0n) > policy.maxFeePerGas)
        throw new BadRequestError({ reason: 'fee-payer policy maxFeePerGas exceeded' });
    if (policy.maxPriorityFeePerGas !== undefined &&
        (prepared.maxPriorityFeePerGas ?? 0n) > policy.maxPriorityFeePerGas)
        throw new BadRequestError({ reason: 'fee-payer policy maxPriorityFeePerGas exceeded' });
    if (policy.maxTotalFee !== undefined &&
        (prepared.gas ?? 0n) * (prepared.maxFeePerGas ?? 0n) > policy.maxTotalFee)
        throw new BadRequestError({ reason: 'fee-payer policy maxTotalFee exceeded' });
}
const UINT96_MAX = 2n ** 96n - 1n;
function assertUint96(amount) {
    if (amount < 0n || amount > UINT96_MAX) {
        throw new VerificationFailedError({ reason: 'amount exceeds uint96 range' });
    }
}
/**
 * Read channel descriptor and state from the TIP20EscrowChannel precompile.
 */
export async function getChannel(client, descriptor, escrow = tip20ChannelEscrow, blockNumber) {
    const channel = await readContract(client, {
        address: escrow,
        abi: escrowAbi,
        functionName: 'getChannel',
        args: [descriptorTuple(descriptor)],
        ...(blockNumber !== undefined ? { blockNumber } : {}),
    });
    return {
        descriptor: channel.descriptor,
        state: stateFromTuple(channel.state),
    };
}
/**
 * Read channel state from the TIP20EscrowChannel precompile.
 */
export async function getChannelState(client, channelId, escrow = tip20ChannelEscrow, blockNumber) {
    const state = await readContract(client, {
        address: escrow,
        abi: escrowAbi,
        functionName: 'getChannelState',
        args: [channelId],
        ...(blockNumber !== undefined ? { blockNumber } : {}),
    });
    return stateFromTuple(state);
}
/**
 * Read channel states from the TIP20EscrowChannel precompile.
 */
export async function getChannelStatesBatch(client, channelIds, escrow = tip20ChannelEscrow) {
    const states = await readContract(client, {
        address: escrow,
        abi: escrowAbi,
        functionName: 'getChannelStatesBatch',
        args: [channelIds],
    });
    return states.map(stateFromTuple);
}
/**
 * Retry an on-chain readback that is pinned to the block containing a just-sent
 * transaction.
 *
 * The escrow state read is served by a load-balanced RPC whose replicas can lag
 * behind the block that produced the transaction receipt. Callers pin the read
 * to that block number (via the `blockNumber` arg on {@link getChannel} /
 * {@link getChannelState}) so a node that has imported the block returns
 * authoritative state; replicas that have not yet imported it throw (e.g.
 * "header not found"), so we retry with a short backoff until one catches up.
 *
 * This closes the read-after-write race behind
 * `on-chain channel state does not match open receipt` — without it, a stale
 * `latest` read on a lagging replica returns an empty channel and fails
 * verification even though the open transaction succeeded.
 */
export async function readbackWithRetry(read, options = {}) {
    const { retries = 5, delayMs = 250 } = options;
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await read();
        }
        catch (error) {
            lastError = error;
            if (attempt < retries)
                await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    throw lastError;
}
function parsePrecompileCredentialTransaction(parameters) {
    const { escrowContract, feePayer, label, serializedTransaction } = parameters;
    if (feePayer && !FeePayer.isTempoTransaction(serializedTransaction))
        throw new BadRequestError({ reason: 'Only Tempo (0x76/0x78) transactions are supported' });
    const transaction = Transaction.deserialize(serializedTransaction);
    const calls = transaction.calls;
    if (calls.length !== 1 && calls.length !== 3)
        throw new VerificationFailedError({
            reason: `TIP-1034 ${label} transaction must contain one management call, optionally preceded by an auto-swap`,
        });
    const call = calls[calls.length - 1];
    if (!call.to || !isAddressEqual(call.to, escrowContract))
        throw new VerificationFailedError({
            reason: `TIP-1034 ${label} transaction targets the wrong address`,
        });
    if (!call.data)
        throw new VerificationFailedError({
            reason: `TIP-1034 ${label} transaction is missing calldata`,
        });
    return {
        transaction,
        call: { ...call, data: call.data, to: call.to },
        prefixCalls: calls.slice(0, -1),
    };
}
function validateAutoSwapPrefix(parameters) {
    const { amountOut, currency, label, prefixCalls } = parameters;
    if (prefixCalls.length === 0)
        return;
    const fail = (reason) => {
        throw new VerificationFailedError({ reason: `TIP-1034 ${label} auto-swap ${reason}` });
    };
    if (prefixCalls.length !== 2)
        fail('must contain exactly approve and swap calls');
    const approveCall = prefixCalls[0];
    const swapCall = prefixCalls[1];
    const approveTo = approveCall.to;
    const approveData = approveCall.data;
    const swapTo = swapCall.to;
    const swapData = swapCall.data;
    if (!approveTo || !approveData || !swapTo || !swapData)
        fail('call is missing a target or calldata');
    const checkedApproveTo = approveTo;
    const checkedApproveData = approveData;
    const checkedSwapTo = swapTo;
    const checkedSwapData = swapData;
    if ((approveCall.value ?? 0n) !== 0n || (swapCall.value ?? 0n) !== 0n)
        fail('calls must not transfer native value');
    if (!isAddressEqual(checkedSwapTo, Addresses.stablecoinDex))
        fail('targets the wrong DEX');
    const approve = (() => {
        try {
            return decodeFunctionData({ abi: Abis.tip20, data: checkedApproveData });
        }
        catch {
            return fail('approval calldata is invalid');
        }
    })();
    const swap = (() => {
        try {
            return decodeFunctionData({ abi: Abis.stablecoinDex, data: checkedSwapData });
        }
        catch {
            return fail('swap calldata is invalid');
        }
    })();
    if (approve.functionName !== 'approve' || swap.functionName !== 'swapExactAmountOut')
        fail('must contain approve followed by swapExactAmountOut');
    const [spender, approvedAmount] = approve.args;
    const [tokenIn, tokenOut, swapAmountOut, maxAmountIn] = swap.args;
    if (!isAddressEqual(checkedApproveTo, tokenIn))
        fail('approval token does not match swap input');
    if (!isAddressEqual(spender, Addresses.stablecoinDex))
        fail('approval spender is not the DEX');
    if (approvedAmount !== maxAmountIn)
        fail('approval amount does not match swap maximum input');
    if (!isAddressEqual(tokenOut, currency))
        fail('output token does not match channel currency');
    if (swapAmountOut !== amountOut)
        fail('output amount does not match channel deposit');
    if (isAddressEqual(tokenIn, tokenOut))
        fail('input and output tokens must differ');
    const canonicalApprove = encodeFunctionData({
        abi: Abis.tip20,
        functionName: 'approve',
        args: [spender, approvedAmount],
    });
    const canonicalSwap = encodeFunctionData({
        abi: Abis.stablecoinDex,
        functionName: 'swapExactAmountOut',
        args: [tokenIn, tokenOut, swapAmountOut, maxAmountIn],
    });
    if (checkedApproveData.toLowerCase() !== canonicalApprove.toLowerCase())
        fail('approval calldata is not canonical');
    if (checkedSwapData.toLowerCase() !== canonicalSwap.toLowerCase())
        fail('swap calldata is not canonical');
}
async function simulateTempoTransaction(client, request) {
    // viem's public `call` type does not yet model Tempo's multi-call and
    // fee-payer fields together. Keep that compatibility cast in one place.
    await call(client, request);
}
/** Simulates an unsponsored client-signed session transaction without broadcasting it. */
export async function simulateCredentialTransaction(parameters) {
    if (parameters.feePayer)
        return;
    await simulateTempoTransaction(parameters.client, FeePayer.simulationTransaction(parameters.transaction, { feePayer: false }));
}
function validateCredentialSponsorship(parameters) {
    const { allowedFeeTokens, challengeExpires, chainId, details, feePayer, feePayerPolicy, transaction, } = parameters;
    if (!feePayer || feePayer === true)
        return;
    FeePayer.prepareSponsoredTransaction({
        account: feePayer,
        allowedFeeTokens,
        challengeExpires,
        chainId,
        details,
        policy: feePayerPolicy,
        transaction: {
            ...transaction,
            ...(allowedFeeTokens[0] ? { feeToken: transaction.feeToken ?? allowedFeeTokens[0] } : {}),
        },
    });
}
async function signTempoTransaction(client, transaction) {
    return (await signTransaction(client, transaction));
}
async function prepareFeePayerCallTransaction(client, parameters) {
    const { account, data, feeToken, to } = parameters;
    // viem's stable request type does not expose Tempo fee-payer transaction
    // fields for this call shape. Keep the cast at the boundary.
    return prepareTransactionRequest(client, {
        account,
        calls: [{ to, data }],
        feePayer: true,
        nonceKey: 'expiring',
        ...(feeToken ? { feeToken } : {}),
    });
}
function sendPrecompileContractCall(client, parameters) {
    const { account, data, feePayer, feeToken, to } = parameters;
    // `feeToken` is Tempo-specific and not represented on viem's base
    // transaction request type.
    return sendViemTransaction(client, {
        ...(account ? { account } : {}),
        to,
        data,
        // Server processes can share a signer without sharing viem's concurrency detection.
        nonceKey: 'expiring',
        ...(feePayer ? { feePayer } : {}),
        ...(feeToken ? { feeToken } : {}),
    });
}
/**
 * Submit a settle transaction on-chain.
 */
export async function settleOnChain(client, descriptor, cumulativeAmount, signature, escrow = tip20ChannelEscrow, options) {
    assertUint96(cumulativeAmount);
    const args = [descriptorTuple(descriptor), cumulativeAmount, signature];
    return sendPrecompileTransaction(client, escrow, encodeFunctionData({ abi: escrowAbi, functionName: 'settle', args }), 'settle', options);
}
/**
 * Submit a top-up transaction on-chain.
 */
export async function topUpOnChain(client, descriptor, additionalDeposit, escrow = tip20ChannelEscrow, options) {
    assertUint96(additionalDeposit);
    const args = [descriptorTuple(descriptor), additionalDeposit];
    return sendPrecompileTransaction(client, escrow, encodeFunctionData({ abi: escrowAbi, functionName: 'topUp', args }), 'topUp', options);
}
/**
 * Submit a request-close transaction on-chain.
 */
export async function requestCloseOnChain(client, descriptor, escrow = tip20ChannelEscrow, options) {
    const args = [descriptorTuple(descriptor)];
    return sendPrecompileTransaction(client, escrow, encodeFunctionData({ abi: escrowAbi, functionName: 'requestClose', args }), 'requestClose', options);
}
/**
 * Submit a withdraw transaction on-chain.
 */
export async function withdrawOnChain(client, descriptor, escrow = tip20ChannelEscrow, options) {
    const args = [descriptorTuple(descriptor)];
    return sendPrecompileTransaction(client, escrow, encodeFunctionData({ abi: escrowAbi, functionName: 'withdraw', args }), 'withdraw', options);
}
/**
 * Submit a close transaction on-chain.
 */
export async function closeOnChain(client, descriptor, cumulativeAmount, captureAmount, signature, escrow = tip20ChannelEscrow, options) {
    assertUint96(cumulativeAmount);
    assertUint96(captureAmount);
    const args = [descriptorTuple(descriptor), cumulativeAmount, captureAmount, signature];
    return sendPrecompileTransaction(client, escrow, encodeFunctionData({ abi: escrowAbi, functionName: 'close', args }), 'close', options);
}
/**
 * Asserts that a deserialized transaction has an existing sender signature.
 */
export function assertSenderSigned(transaction) {
    if (!transaction.signature || !transaction.from)
        throw new BadRequestError({
            reason: 'Transaction must be signed by the sender before fee payer co-signing',
        });
}
/** Broadcast a raw serialized transaction. */
export async function sendTransaction(client, transaction) {
    return sendRawTransaction(client, { serializedTransaction: transaction });
}
/** Wait for a receipt and reject reverted precompile transactions. */
export async function waitForSuccessfulReceipt(client, hash) {
    const receipt = await waitForTransactionReceipt(client, { hash, checkReplacement: false });
    if (receipt.status !== 'success')
        throw new VerificationFailedError({ reason: 'precompile transaction reverted' });
    return receipt;
}
/** Extract exactly one channel event for a channel ID from a receipt. */
export function getChannelEvent(receipt, name, channelId) {
    const logs = parseEventLogs({
        abi: escrowAbi,
        eventName: name,
        logs: receipt.logs,
    });
    const matches = logs.filter((log) => log.args.channelId.toLowerCase() === channelId.toLowerCase());
    if (matches.length !== 1)
        throw new VerificationFailedError({
            reason: `expected one ${name} event for credential channelId in receipt`,
        });
    return matches[0];
}
/** Broadcasts a client-signed management transaction, adding a fee-payer co-signature when requested. */
export async function sendCredentialTransaction(parameters) {
    const { challengeExpires, chainId, client, allowedFeeTokens, details, feePayer, feePayerPolicy, label, serializedTransaction, transaction, } = parameters;
    if (!feePayer) {
        const txHash = await sendTransaction(client, serializedTransaction);
        return waitForSuccessfulReceipt(client, txHash);
    }
    if (!FeePayer.isTempoTransaction(serializedTransaction))
        throw new BadRequestError({ reason: 'Only Tempo (0x76/0x78) transactions are supported' });
    assertSenderSigned(transaction);
    if (feePayer === true) {
        // The transport owns hosted completion, so mppx can only preflight call
        // execution as the sender. It intentionally omits fee fields here; the
        // transport is responsible for validating its final sponsored envelope.
        await simulateTempoTransaction(client, FeePayer.simulationTransaction(transaction, { feePayer: true }));
        const txHash = await sendTransaction(client, serializedTransaction);
        return waitForSuccessfulReceipt(client, txHash);
    }
    const sponsorshipTransaction = {
        ...transaction,
        ...(allowedFeeTokens?.[0] ? { feeToken: transaction.feeToken ?? allowedFeeTokens[0] } : {}),
    };
    const completed = await FeePayer.preflightSponsorship({
        transaction: sponsorshipTransaction,
        simulate: (request) => simulateTempoTransaction(client, request),
        async complete() {
            const sponsored = FeePayer.prepareSponsoredTransaction({
                account: feePayer,
                allowedFeeTokens,
                challengeExpires,
                chainId,
                details,
                policy: feePayerPolicy,
                transaction: sponsorshipTransaction,
            });
            return { feePayer: feePayer.address, transaction: sponsored };
        },
    });
    const serialized = await signTempoTransaction(client, completed.transaction);
    const receipt = await sendRawTransactionSync(client, {
        serializedTransaction: serialized,
    });
    if (receipt.status !== 'success')
        throw new VerificationFailedError({
            reason: `${label} precompile transaction reverted: ${receipt.transactionHash}`,
        });
    return receipt;
}
/** Validates the immutable fields of a client-signed TIP-1034 open transaction. */
export function validateOpenCredentialTransaction(parameters) {
    const { transaction, call, prefixCalls } = parsePrecompileCredentialTransaction({
        escrowContract: parameters.escrowContract,
        feePayer: parameters.feePayer,
        label: 'open',
        serializedTransaction: parameters.serializedTransaction,
    });
    const payer = transaction.from ?? parameters.expectedPayer;
    const open = ChannelOps.parseOpenCall({
        data: call.data,
        expected: {
            payee: parameters.expectedPayee,
            token: parameters.expectedCurrency,
            operator: parameters.expectedOperator,
            authorizedSigner: parameters.expectedAuthorizedSigner,
        },
    });
    validateAutoSwapPrefix({
        amountOut: open.deposit,
        currency: parameters.expectedCurrency,
        label: 'open',
        prefixCalls,
    });
    const descriptor = ChannelOps.descriptorFromOpen({
        chainId: parameters.chainId,
        escrow: parameters.escrowContract,
        payer,
        open,
        expiringNonceHash: parameters.expectedExpiringNonceHash,
        channelId: parameters.expectedChannelId,
    });
    if (parameters.feePayer)
        assertSenderSigned(transaction);
    validateCredentialSponsorship({
        allowedFeeTokens: parameters.allowedFeeTokens ?? [parameters.expectedCurrency],
        challengeExpires: parameters.challengeExpires,
        chainId: parameters.chainId,
        details: {
            channelId: parameters.expectedChannelId,
            currency: parameters.expectedCurrency,
            recipient: parameters.expectedPayee,
        },
        feePayer: parameters.feePayer,
        feePayerPolicy: parameters.feePayerPolicy,
        transaction,
    });
    const expiringNonceHash = ChannelUtils.computeExpiringNonceHash(ChannelUtils.transactionForExpiringNonceHash({
        feePayer: parameters.feePayer,
        transaction,
    }), { sender: payer });
    if (expiringNonceHash.toLowerCase() !== descriptor.expiringNonceHash.toLowerCase())
        throw new VerificationFailedError({
            reason: 'credential expiringNonceHash does not match transaction',
        });
    return { descriptor, expiringNonceHash, openDeposit: open.deposit, transaction };
}
/** Broadcast and validate a client-signed TIP-1034 open transaction. */
export async function broadcastOpenTransaction(parameters) {
    const { descriptor, expiringNonceHash, openDeposit, transaction } = validateOpenCredentialTransaction(parameters);
    await parameters.beforeBroadcast?.({
        descriptor,
        expiringNonceHash,
        openDeposit,
    });
    const receipt = await sendCredentialTransaction({
        challengeExpires: parameters.challengeExpires,
        chainId: parameters.chainId,
        client: parameters.client,
        allowedFeeTokens: parameters.allowedFeeTokens ?? [parameters.expectedCurrency],
        details: {
            channelId: parameters.expectedChannelId,
            currency: parameters.expectedCurrency,
            recipient: parameters.expectedPayee,
        },
        feePayer: parameters.feePayer,
        feePayerPolicy: parameters.feePayerPolicy,
        label: 'open',
        serializedTransaction: parameters.serializedTransaction,
        transaction,
    });
    const opened = readChannelOpenedReceiptFields(getChannelEvent(receipt, 'ChannelOpened', parameters.expectedChannelId));
    validateChannelOpenedReceipt({
        chainId: parameters.chainId,
        descriptor,
        emittedChannelId: opened.channelId,
        emittedDeposit: opened.deposit,
        emittedExpiringNonceHash: opened.expiringNonceHash,
        escrow: parameters.escrowContract,
        expectedChannelId: parameters.expectedChannelId,
        openDeposit,
    });
    const chainChannel = await readbackWithRetry(() => getChannel(parameters.client, descriptor, parameters.escrowContract, receipt.blockNumber));
    const state = chainChannel.state;
    validateOpenReadbackState({ emittedDeposit: opened.deposit, state });
    return {
        txHash: receipt.transactionHash,
        descriptor,
        state,
        expiringNonceHash: opened.expiringNonceHash,
        openDeposit,
    };
}
/** Validates the immutable fields of a client-signed TIP-1034 top-up transaction. */
export function validateTopUpCredentialTransaction(parameters) {
    const { transaction, call, prefixCalls } = parsePrecompileCredentialTransaction({
        escrowContract: parameters.escrowContract,
        feePayer: parameters.feePayer,
        label: 'topUp',
        serializedTransaction: parameters.serializedTransaction,
    });
    ChannelOps.parseTopUpCall({
        data: call.data,
        expected: {
            descriptor: parameters.descriptor,
            additionalDeposit: parameters.additionalDeposit,
        },
    });
    validateAutoSwapPrefix({
        amountOut: parameters.additionalDeposit,
        currency: parameters.expectedCurrency,
        label: 'topUp',
        prefixCalls,
    });
    if (parameters.feePayer)
        assertSenderSigned(transaction);
    validateCredentialSponsorship({
        allowedFeeTokens: parameters.allowedFeeTokens ?? [parameters.expectedCurrency],
        challengeExpires: parameters.challengeExpires,
        chainId: parameters.chainId,
        details: {
            additionalDeposit: parameters.additionalDeposit.toString(),
            channelId: parameters.expectedChannelId,
            currency: parameters.expectedCurrency,
        },
        feePayer: parameters.feePayer,
        feePayerPolicy: parameters.feePayerPolicy,
        transaction,
    });
    return { transaction };
}
/** Broadcast and validate a client-signed TIP-1034 top-up transaction. */
export async function broadcastTopUpTransaction(parameters) {
    const { transaction } = validateTopUpCredentialTransaction(parameters);
    const receipt = await sendCredentialTransaction({
        challengeExpires: parameters.challengeExpires,
        chainId: parameters.chainId,
        client: parameters.client,
        allowedFeeTokens: parameters.allowedFeeTokens ?? [parameters.expectedCurrency],
        details: {
            additionalDeposit: parameters.additionalDeposit.toString(),
            channelId: parameters.expectedChannelId,
            currency: parameters.expectedCurrency,
        },
        feePayer: parameters.feePayer,
        feePayerPolicy: parameters.feePayerPolicy,
        label: 'topUp',
        serializedTransaction: parameters.serializedTransaction,
        transaction,
    });
    const toppedUp = readTopUpReceiptFields(getChannelEvent(receipt, 'TopUp', parameters.expectedChannelId));
    validateTopUpReceipt({
        emittedChannelId: toppedUp.channelId,
        expectedChannelId: parameters.expectedChannelId,
    });
    const state = await readbackWithRetry(() => getChannelState(parameters.client, toppedUp.channelId, parameters.escrowContract, receipt.blockNumber));
    validateTopUpReadbackState({ newDeposit: toppedUp.newDeposit, state });
    return { txHash: receipt.transactionHash, newDeposit: toppedUp.newDeposit, state };
}
function stateFromTuple(state) {
    assertUint96(state.settled);
    assertUint96(state.deposit);
    return {
        settled: state.settled,
        deposit: state.deposit,
        closeRequestedAt: state.closeRequestedAt,
    };
}
function descriptorTuple(descriptor) {
    return {
        payer: descriptor.payer,
        payee: descriptor.payee,
        operator: descriptor.operator,
        token: descriptor.token,
        salt: descriptor.salt,
        authorizedSigner: descriptor.authorizedSigner,
        expiringNonceHash: descriptor.expiringNonceHash,
    };
}
async function sendPrecompileTransaction(client, to, data, label, options) {
    const account = options?.account ?? client.account;
    const feePayer = options?.feePayer;
    const selfSponsored = account && typeof feePayer === 'object' && isAddressEqual(account.address, feePayer.address);
    if (feePayer === true) {
        if (!account)
            throw new Error(`Cannot ${label} precompile channel: no account available.`);
        return sendPrecompileContractCall(client, {
            account,
            data,
            feePayer: true,
            feeToken: options.feeToken,
            to,
        });
    }
    if (feePayer && !selfSponsored) {
        if (!account)
            throw new Error(`Cannot ${label} precompile channel: no account available.`);
        const feeToken = options.feeToken ??
            (await resolveFeeToken({
                account: feePayer.address,
                candidateTokens: options.candidateFeeTokens,
                client,
            }));
        const prepared = await prepareFeePayerCallTransaction(client, {
            account,
            data,
            feeToken,
            to,
        });
        assertPrecompileFeePayerPolicy({ prepared, policy: options.feePayerPolicy });
        const serialized = await signTempoTransaction(client, {
            ...prepared,
            account,
            feePayer,
        });
        const receipt = await sendRawTransactionSync(client, {
            serializedTransaction: serialized,
        });
        if (receipt.status !== 'success')
            throw new VerificationFailedError({
                reason: `${label} precompile transaction reverted: ${receipt.transactionHash}`,
            });
        return receipt.transactionHash;
    }
    const feeToken = options?.feeToken ??
        (selfSponsored
            ? await resolveFeeToken({
                account: account.address,
                candidateTokens: options?.candidateFeeTokens,
                client,
            })
            : undefined);
    return sendPrecompileContractCall(client, {
        account,
        to,
        data,
        feeToken,
    });
}
//# sourceMappingURL=Chain.js.map