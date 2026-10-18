import { isAddress, isAddressEqual, parseUnits, zeroAddress, } from 'viem';
import { BadRequestError, ChannelClosedError, ChannelNotFoundError, InsufficientBalanceError, VerificationFailedError, } from '../../../Errors.js';
import { isSessionContentRequest } from '../../server/internal/request-body.js';
import * as Chain from '../precompile/Chain.js';
import { readSettledReceiptFields } from '../precompile/Chain.js';
import { uint96, } from '../precompile/Protocol.js';
import * as ChannelStore from './ChannelStore.js';
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
function isAccount(value) {
    return isObject(value) && typeof value.address === 'string' && isAddress(value.address);
}
/** Reads the optional `feePayer` field from an untrusted request object. */
export function readRequestFeePayer(value) {
    if (!isObject(value))
        return undefined;
    const feePayer = value.feePayer;
    if (feePayer === undefined || typeof feePayer === 'boolean')
        return feePayer;
    if (isAccount(feePayer))
        return feePayer;
    return undefined;
}
/** Resolves whether a challenge should advertise fee sponsorship or a credential can use it. */
export function resolveRequestFeePayer(parameters) {
    const { credential, defaultFeePayer, parameterFeePayer, requestFeePayer } = parameters;
    if (requestFeePayer === false)
        return credential ? false : undefined;
    const account = typeof requestFeePayer === 'object' ? requestFeePayer : defaultFeePayer;
    const hosted = parameterFeePayer === true || typeof parameterFeePayer === 'string';
    if (credential)
        return account ?? (hosted ? true : undefined);
    if (account || hosted)
        return true;
    return undefined;
}
/** Resolves the fee-payer account allowed for an incoming credential. */
export function resolveCredentialFeePayer(parameters) {
    const { feePayer, methodDetails, request } = parameters;
    const requestFeePayer = readRequestFeePayer(request);
    const requestAllowsFeePayer = requestFeePayer === undefined || requestFeePayer === true || typeof requestFeePayer === 'object';
    if (methodDetails.feePayer !== true || !requestAllowsFeePayer)
        return undefined;
    if (typeof requestFeePayer === 'object')
        return requestFeePayer;
    if (typeof feePayer === 'object')
        return feePayer;
    return feePayer === true || typeof feePayer === 'string' ? true : undefined;
}
/** Converts a public settlement schedule into raw-unit thresholds. */
export function resolveSettlementSchedule(schedule, decimals) {
    if (!schedule)
        return undefined;
    return {
        ...(schedule.amount !== undefined && {
            amount: typeof schedule.amount === 'bigint'
                ? schedule.amount
                : parseUnits(schedule.amount, decimals),
        }),
        ...(schedule.intervalMs !== undefined && { intervalMs: schedule.intervalMs }),
        ...(schedule.units !== undefined && { units: schedule.units }),
    };
}
/**
 * Computes the schedule progress for an unsettled precompile-backed channel.
 *
 * Returns `undefined` for channels that cannot be scheduled: non-precompile
 * records, channels without an accepted voucher, or channels with no unsettled
 * voucher amount.
 */
export function resolveSettlementProgress(channel) {
    if (!ChannelStore.isPrecompileState(channel))
        return undefined;
    if (!channel.highestVoucher)
        return undefined;
    if (channel.highestVoucher.cumulativeAmount <= channel.settledOnChain)
        return undefined;
    const amountBoundary = channel.lastSettlementSpent ?? channel.settledOnChain;
    const timestampBoundary = Date.parse(channel.lastSettlementAt ?? channel.createdAt);
    return {
        amount: channel.spent - amountBoundary,
        ...(Number.isFinite(timestampBoundary) && {
            elapsedMs: Date.now() - timestampBoundary,
        }),
        units: channel.units - (channel.lastSettlementUnits ?? 0),
    };
}
/** Returns whether the precompile channel has crossed any configured settlement threshold. */
export function isSettlementDue(channel, schedule) {
    if (!schedule)
        return false;
    const progress = resolveSettlementProgress(channel);
    if (!progress)
        return false;
    if (schedule.units !== undefined && progress.units >= schedule.units)
        return true;
    if (schedule.amount !== undefined && progress.amount >= schedule.amount)
        return true;
    if (schedule.intervalMs !== undefined && (progress.elapsedMs ?? 0) >= schedule.intervalMs)
        return true;
    return false;
}
/** Records the channel spend/unit counters that a scheduled settlement captured. */
export async function markSettlementComplete(parameters) {
    const { channelId, store, settledAt = new Date().toISOString() } = parameters;
    await store.updateChannel(channelId, (current) => current
        ? {
            ...current,
            lastSettlementAt: settledAt,
            lastSettlementSpent: current.spent,
            lastSettlementUnits: current.units,
        }
        : current);
}
/** Returns whether an accepted credential will authorize and charge an HTTP content response. */
export function shouldApplyVerifiedHttpAccounting(parameters) {
    const { capturedRequest, payloadAction, sseEnabled } = parameters;
    if (!capturedRequest)
        return false;
    if (payloadAction !== 'open' && payloadAction !== 'voucher')
        return false;
    if (sseEnabled && capturedRequest.method === 'POST')
        return false;
    return isSessionContentRequest(capturedRequest);
}
/** Applies the default HTTP content charge after a session credential has been accepted. */
export async function applyVerifiedHttpAccounting(parameters) {
    const { receipt, sseEnabled } = parameters;
    if (!shouldApplyVerifiedHttpAccounting(parameters))
        return receipt;
    const requestAmount = parameters.getRequestAmount();
    const charged = await parameters.charge(receipt.channelId, requestAmount);
    const settlementTxHash = await parameters.settleCharged(charged);
    const chargedReceipt = {
        ...receipt,
        spent: charged.spent.toString(),
        units: charged.units,
        ...(settlementTxHash ? { txHash: settlementTxHash } : {}),
    };
    return sseEnabled
        ? (parameters.markPrepaidReceipt?.(chargedReceipt) ?? chargedReceipt)
        : chargedReceipt;
}
/** Atomically deducts spend from a channel and maps store failures to typed session errors. */
export async function chargeSessionChannel(parameters) {
    const { store, channelId, amount } = parameters;
    let result;
    try {
        result = await ChannelStore.deductFromChannel(store, channelId, amount);
    }
    catch {
        throw new ChannelClosedError({ reason: 'channel not found' });
    }
    if (!result.ok) {
        if (result.channel.finalized)
            throw new ChannelClosedError({ reason: 'channel is finalized' });
        if (result.channel.closeRequestedAt !== 0n)
            throw new ChannelClosedError({ reason: 'channel has a pending close request' });
        const available = result.channel.highestVoucherAmount - result.channel.spent;
        throw new InsufficientBalanceError({
            reason: `requested ${amount}, available ${available}`,
        });
    }
    return result.channel;
}
/** Resolves either a generic mppx store or an already-wrapped channel store. */
export function resolveChannelStore(store) {
    return 'getChannel' in store ? store : ChannelStore.fromStore(store);
}
/** Returns the account attached to a viem client, when one exists. */
export function getClientAccount(client) {
    return client.account;
}
/** Validates that the transaction sender is the channel payee or nonzero operator. */
export function assertSettlementSender(parameters) {
    const { operation, channelId, operator, payee, sender } = parameters;
    if (!sender)
        throw new Error(`Cannot ${operation} precompile channel ${channelId}: no account available. Pass an account override, or provide a getClient() that returns an account-bearing client.`);
    if (isAddressEqual(sender, payee))
        return;
    if (!isAddressEqual(operator, zeroAddress) && isAddressEqual(sender, operator))
        return;
    throw new BadRequestError({
        reason: `Cannot ${operation} precompile channel ${channelId}: tx sender ${sender} is not the channel payee ${payee}` +
            (isAddressEqual(operator, zeroAddress) ? '.' : ` or operator ${operator}.`) +
            ' If using an access key, pass a Tempo access-key account whose address is the payee/operator wallet, not the raw delegated key address.',
    });
}
/** Applies automatic settlement when the server-owned schedule is due. */
export async function maybeSettleScheduled(parameters) {
    const { channel, schedule, store } = parameters;
    if (!isSettlementDue(channel, schedule))
        return undefined;
    const txHash = await settle(store, parameters.client, channel.channelId, {
        account: parameters.account,
        ...(parameters.feePayer ? { feePayer: parameters.feePayer } : {}),
        ...(parameters.feePayerPolicy ? { feePayerPolicy: parameters.feePayerPolicy } : {}),
        ...(parameters.feeToken ? { feeToken: parameters.feeToken } : {}),
        onSessionSettlement: parameters.onSessionSettlement
            ? (ctx) => parameters.onSessionSettlement({ ...ctx, trigger: 'scheduled' })
            : undefined,
    });
    await markSettlementComplete({ channelId: channel.channelId, store });
    return txHash;
}
/** Settles the highest accepted voucher for a precompile-backed session channel. */
export async function settle(store_, client, channelId_, options) {
    const store = resolveChannelStore(store_);
    const channelId = ChannelStore.normalizeChannelId(channelId_);
    const channel = await store.getChannel(channelId);
    if (!channel)
        throw new ChannelNotFoundError({ reason: 'channel not found' });
    if (!ChannelStore.isPrecompileState(channel))
        throw new VerificationFailedError({ reason: 'channel is not precompile-backed' });
    if (!channel.highestVoucher)
        throw new VerificationFailedError({ reason: 'no voucher to settle' });
    const escrow = options?.escrowContract ?? channel.escrowContract;
    const account = options?.account ?? getClientAccount(client);
    assertSettlementSender({
        operation: 'settle',
        channelId,
        operator: channel.operator,
        payee: channel.payee,
        sender: account?.address,
    });
    const amount = uint96(channel.highestVoucher.cumulativeAmount);
    const txHash = await Chain.settleOnChain(client, channel.descriptor, amount, channel.highestVoucher.signature, escrow, account
        ? {
            account,
            ...(options?.feePayer ? { feePayer: options.feePayer } : {}),
            ...(options?.feePayerPolicy ? { feePayerPolicy: options.feePayerPolicy } : {}),
            ...(options?.feeToken ? { feeToken: options.feeToken } : {}),
            candidateFeeTokens: options?.candidateFeeTokens ?? [channel.token],
        }
        : undefined);
    const receipt = await Chain.waitForSuccessfulReceipt(client, txHash);
    const settled = readSettledReceiptFields(Chain.getChannelEvent(receipt, 'Settled', channelId));
    const { newSettled } = settled;
    if (newSettled < amount)
        throw new VerificationFailedError({ reason: 'Settled event is below voucher amount' });
    const state = await Chain.getChannelState(client, channelId, escrow);
    if (state.settled !== newSettled)
        throw new VerificationFailedError({
            reason: 'on-chain channel state does not match settle receipt',
        });
    await store.updateChannel(channelId, (current) => current
        ? {
            ...current,
            settledOnChain: newSettled > current.settledOnChain ? newSettled : current.settledOnChain,
            lastSettlementAt: new Date().toISOString(),
            lastSettlementSpent: current.spent,
            lastSettlementUnits: current.units,
        }
        : current);
    if (options?.onSessionSettlement) {
        await emitSessionSettlement(options.onSessionSettlement, {
            txHash,
            channelId,
            trigger: 'settle',
            amount: newSettled,
            delta: newSettled - channel.settledOnChain,
        });
    }
    return txHash;
}
/** Settles multiple precompile-backed session channels with the same validation as {@link settle}. */
export async function settleBatch(store, client, channelIds, options) {
    const hashes = [];
    for (const channelId of channelIds)
        hashes.push(await settle(store, client, channelId, options));
    return hashes;
}
async function emitSessionSettlement(onSessionSettlement, context) {
    try {
        await onSessionSettlement(Object.freeze(context));
    }
    catch {
        // Errors are isolated — observers cannot break the settlement flow.
    }
}
//# sourceMappingURL=Settlement.js.map