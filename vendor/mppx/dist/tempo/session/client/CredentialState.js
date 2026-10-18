import { isAddress, parseUnits, } from 'viem';
import * as Constants from '../../../Constants.js';
import { assertAllowedChainId, assertChainId } from '../../../viem/Client.js';
import * as z from '../../../zod.js';
import * as AutoSwap from '../../internal/auto-swap.js';
import * as Chain from '../precompile/Chain.js';
import * as Channel from '../precompile/Channel.js';
import * as Voucher from '../precompile/Voucher.js';
import { createClosePayload, createOpenPayload, createTopUpPayload, createVoucherPayload, isSameAddress, resolveAuthorizedSigner, resolveEscrow, } from './ChannelOps.js';
import { channelKey, entryKey } from './ChannelStore.js';
import { assertWithinMaxDeposit, resolveOpeningDeposit } from './Runtime.js';
/** Returns whether a credential payload carries cumulative voucher authorization. */
export function hasCredentialCumulativeAmount(payload) {
    return 'cumulativeAmount' in payload;
}
/** Reads cumulative authorization from a credential payload when the action carries one. */
export function readCredentialCumulativeAmount(payload) {
    if (!hasCredentialCumulativeAmount(payload))
        return undefined;
    return BigInt(payload.cumulativeAmount);
}
/**
 * Persists a channel entry through the sink and notifies observers. Closed
 * channels are removed from the store but still reported to observers so callers
 * can react to the close.
 */
async function storeChannelEntry(sink, entry) {
    if (entry.opened)
        await sink.store.set(entry);
    else
        await sink.store.delete(entryKey(entry));
    sink.notifyUpdate(entry);
}
/** Applies a credential payload's cumulative amount to the stored channel at `key`. */
async function applyCumulative(sink, key, payload) {
    const cumulativeAmount = readCredentialCumulativeAmount(payload);
    if (cumulativeAmount === undefined)
        return;
    const entry = await sink.store.get(key);
    if (!entry)
        return;
    if (entry.channelId.toLowerCase() !== payload.channelId.toLowerCase())
        return;
    entry.cumulativeAmount =
        entry.cumulativeAmount > cumulativeAmount ? entry.cumulativeAmount : cumulativeAmount;
    if (payload.action === 'close')
        entry.opened = false;
    await storeChannelEntry(sink, entry);
}
const hexSchema = z.custom((value) => typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value));
const hashSchema = z.custom((value) => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value));
/** Runtime schema for low-level TIP-1034 session credential context. */
export const sessionContextSchema = z.object({
    account: z.optional(z.custom()),
    autoSwap: z.optional(z.custom()),
    action: z.optional(z.enum(['open', 'topUp', 'voucher', 'close'])),
    channelId: z.optional(hashSchema),
    cumulativeAmount: z.optional(z.amount()),
    cumulativeAmountRaw: z.optional(z.string()),
    transaction: z.optional(hexSchema),
    descriptor: z.optional(z.custom()),
    additionalDeposit: z.optional(z.amount()),
    additionalDepositRaw: z.optional(z.string()),
    depositRaw: z.optional(z.string()),
});
/** Returns whether a session context contains an explicit manual action. */
export function hasSessionAction(context) {
    return context?.action !== undefined;
}
/** Returns whether a context is a manual action with the descriptor required to execute it. */
export function hasManualSessionDescriptor(context) {
    return hasSessionAction(context) && context.descriptor !== undefined;
}
/** Returns whether a session context contains a recoverable channel descriptor. */
export function hasSessionDescriptor(context) {
    return context?.descriptor !== undefined;
}
/** Parses an optional session context amount, preferring the raw-unit field when present. */
export function parseOptionalContextAmount(context, decimals, field) {
    const raw = field === 'additionalDeposit' ? context.additionalDepositRaw : context.cumulativeAmountRaw;
    const amount = field === 'additionalDeposit' ? context.additionalDeposit : context.cumulativeAmount;
    if (raw)
        return BigInt(raw);
    if (amount)
        return parseUnits(amount, decimals);
    return undefined;
}
/** Parses a required session context amount and throws with action-specific context when absent. */
export function requireContextAmount(context, decimals, field, action) {
    const amount = parseOptionalContextAmount(context, decimals, field);
    if (amount === undefined)
        throw new Error(`${field} required for ${action} action`);
    return amount;
}
function isObject(value) {
    return typeof value === 'object' && value !== null;
}
function readOptionalAddress(value) {
    return typeof value === 'string' && isAddress(value, { strict: false }) ? value : undefined;
}
function readMethodDetails(challenge) {
    const methodDetails = challenge.request.methodDetails;
    if (!isObject(methodDetails))
        return {};
    return {
        chainId: typeof methodDetails.chainId === 'number' ? methodDetails.chainId : undefined,
        escrowContract: readOptionalAddress(methodDetails.escrowContract),
        escrow: readOptionalAddress(methodDetails.escrow),
        feePayer: typeof methodDetails.feePayer === 'boolean' ? methodDetails.feePayer : undefined,
        feeToken: readOptionalAddress(methodDetails.feeToken),
        operator: readOptionalAddress(methodDetails.operator),
        sessionSnapshot: Constants.getMethodDetail(methodDetails, Constants.MethodDetailKeys.sessionSnapshot),
    };
}
function readAddress(value, label) {
    if (typeof value === 'string' && isAddress(value, { strict: false }))
        return value;
    throw new Error(`tempo session challenge missing ${label}`);
}
function readAmount(value) {
    if (typeof value === 'string')
        return BigInt(value);
    throw new Error('tempo session challenge missing amount');
}
function readSuggestedDeposit(value) {
    return typeof value === 'string' ? value : undefined;
}
/** Resolves raw challenge fields into the typed data required by client credential planning. */
export async function resolveChallengeContext(parameters) {
    const { allowCustomEscrow, challenge, escrowOverride, allowedChainIds, getClient } = parameters;
    const methodDetails = readMethodDetails(challenge);
    if (methodDetails.chainId !== undefined || allowedChainIds?.length === 0)
        assertAllowedChainId(allowedChainIds, methodDetails.chainId);
    const requestedChainId = methodDetails.chainId ?? (allowedChainIds?.length === 1 ? allowedChainIds[0] : undefined);
    const client = await getClient({ chainId: requestedChainId });
    assertChainId(client, requestedChainId);
    const chainId = requestedChainId ?? client.chain?.id;
    assertAllowedChainId(allowedChainIds, chainId);
    if (!chainId)
        throw new Error('No chainId configured for TIP-1034 session challenge.');
    const escrow = resolveEscrow(challenge, escrowOverride, allowCustomEscrow);
    const payee = readAddress(challenge.request.recipient, 'recipient');
    const token = readAddress(challenge.request.currency, 'currency');
    return {
        amount: readAmount(challenge.request.amount),
        challenge,
        chainId,
        client,
        escrow,
        feePayer: methodDetails.feePayer,
        feeToken: methodDetails.feeToken,
        key: channelKey({ payee, token, escrow, chainId }),
        operator: methodDetails.operator,
        payee,
        snapshot: methodDetails.sessionSnapshot,
        suggestedDepositRaw: readSuggestedDeposit(challenge.request.suggestedDeposit),
        token,
    };
}
/** Validates descriptor identity and reads open channel state for client-side recovery. */
export async function resolveReusableChannel(parameters) {
    const { channelId, client, descriptor, expected, readChannelState = Chain.getChannelState, } = parameters;
    const expectedChannelId = Channel.computeId({
        ...descriptor,
        chainId: expected.chainId,
        escrow: expected.escrow,
    });
    assertReusableChannelDescriptor({
        channelId,
        descriptor,
        expectedChannelId,
        payee: expected.payee,
        payer: expected.payer,
        authorizedSigner: expected.authorizedSigner,
        token: expected.token,
    });
    const state = await readChannelState(client, expectedChannelId, expected.escrow);
    if (state.deposit === 0n)
        throw new Error(`Channel ${expectedChannelId} cannot be reused (closed or not found on-chain).`);
    if (state.closeRequestedAt !== 0)
        throw new Error(`Channel ${expectedChannelId} cannot be reused (pending close request).`);
    return { channelId: expectedChannelId, state };
}
function assertReusableChannelDescriptor(parameters) {
    const { authorizedSigner, channelId, descriptor, expectedChannelId, payee, payer, token } = parameters;
    if (channelId && channelId.toLowerCase() !== expectedChannelId.toLowerCase())
        throw new Error('context channelId does not match descriptor');
    if (!isSameAddress(descriptor.payee, payee))
        throw new Error('context descriptor payee does not match challenge');
    if (!isSameAddress(descriptor.token, token))
        throw new Error('context descriptor token does not match challenge');
    if (!isSameAddress(descriptor.payer, payer))
        throw new Error('context descriptor payer does not match account');
    if (!isSameAddress(Channel.resolveAuthorizedSigner(descriptor), authorizedSigner))
        throw new Error('context descriptor authorizedSigner does not match account');
}
/** Resolves descriptor-based recovery data, preferring caller context over server hints. */
export function resolveRecoverContext(parameters) {
    const { context, snapshot } = parameters;
    const descriptor = context?.descriptor ?? snapshot?.descriptor;
    if (!descriptor)
        return undefined;
    return {
        ...context,
        channelId: context?.channelId ?? snapshot?.channelId,
        descriptor,
    };
}
/** Resolves a voucher boundary that can satisfy the resumed request. */
export function resolveRecoveredCumulative(parameters) {
    const { context, decimals, requestAmount, snapshot, settled } = parameters;
    if (snapshot) {
        return [
            BigInt(snapshot.acceptedCumulative),
            BigInt(snapshot.requiredCumulative),
            BigInt(snapshot.spent) + requestAmount,
            settled,
        ].reduce((highest, value) => (value > highest ? value : highest), 0n);
    }
    const contextCumulative = parseOptionalContextAmount(context, decimals, 'cumulativeAmount');
    if (contextCumulative !== undefined)
        return contextCumulative + requestAmount;
    return settled + requestAmount;
}
/** Checks a server snapshot against its signed voucher and current TIP-1034 state. */
export async function hydrateSessionSnapshot(parameters) {
    const { account, client, readChannelState, snapshot } = parameters;
    const signed = snapshot.highestVoucher;
    if (!signed)
        throw new Error('session snapshot is missing its highest signed voucher');
    if (signed.channelId.toLowerCase() !== snapshot.channelId.toLowerCase())
        throw new Error('session snapshot voucher channelId does not match snapshot channelId');
    const acceptedCumulative = BigInt(snapshot.acceptedCumulative);
    const voucherCumulative = BigInt(signed.cumulativeAmount);
    const requiredCumulative = BigInt(snapshot.requiredCumulative);
    const snapshotDeposit = BigInt(snapshot.deposit);
    const snapshotSettled = BigInt(snapshot.settled);
    const spent = BigInt(snapshot.spent);
    if (voucherCumulative !== acceptedCumulative)
        throw new Error('session snapshot voucher amount does not match acceptedCumulative');
    if (spent > acceptedCumulative)
        throw new Error('session snapshot spent exceeds acceptedCumulative');
    if (snapshotSettled > snapshotDeposit)
        throw new Error('session snapshot settled amount exceeds deposit');
    if (!Voucher.verifyVoucher(snapshot.escrow, snapshot.chainId, {
        channelId: signed.channelId,
        cumulativeAmount: voucherCumulative,
        signature: signed.signature,
    }, Channel.resolveAuthorizedSigner(snapshot.descriptor)))
        throw new Error('session snapshot highest voucher signature is invalid');
    const reusable = await resolveReusableChannel({
        channelId: snapshot.channelId,
        client,
        descriptor: snapshot.descriptor,
        expected: {
            chainId: snapshot.chainId,
            escrow: snapshot.escrow,
            payee: snapshot.descriptor.payee,
            payer: account.address,
            authorizedSigner: resolveAuthorizedSigner(account),
            token: snapshot.descriptor.token,
        },
        readChannelState,
    });
    const cumulativeAmount = [acceptedCumulative, requiredCumulative, reusable.state.settled].reduce((highest, value) => (value > highest ? value : highest), 0n);
    if (cumulativeAmount > reusable.state.deposit)
        throw new Error('recovered session cumulative amount exceeds on-chain channel deposit');
    return {
        entry: {
            channelId: reusable.channelId,
            cumulativeAmount,
            deposit: reusable.state.deposit,
            descriptor: snapshot.descriptor,
            escrow: snapshot.escrow,
            chainId: snapshot.chainId,
            opened: true,
        },
        spent,
    };
}
/** Returns whether `account` can satisfy the descriptor's voucher authority. */
export function canSignDescriptor(account, descriptor) {
    // Only the payer can deposit into and voucher against its own channel.
    if (!isSameAddress(account.address, descriptor.payer))
        return false;
    return isSameAddress(resolveAuthorizedSigner(account), Channel.resolveAuthorizedSigner(descriptor));
}
/** Chooses the next credential plan from local channel cache and optional caller context. */
export function planCredential(parameters) {
    const { account, entry, context, decimals, maxDeposit, resolved } = parameters;
    if (hasSessionAction(context)) {
        if (!hasManualSessionDescriptor(context))
            throw new Error('descriptor required for TIP-1034 session action');
        return {
            type: 'manual',
            account,
            context,
            decimals,
            resolved,
        };
    }
    if (!entry && context?.channelId && !context.descriptor)
        throw new Error('descriptor required to reuse TIP-1034 channel');
    const recoverContext = resolveRecoverContext({ context, snapshot: resolved.snapshot });
    if (!entry && recoverContext && canSignDescriptor(account, recoverContext.descriptor)) {
        return {
            type: 'recover',
            account,
            context: recoverContext,
            decimals,
            maxDeposit,
            resolved,
        };
    }
    if (entry?.opened && canSignDescriptor(account, entry.descriptor))
        return { type: 'voucher', account, entry, maxDeposit, resolved };
    return { type: 'open', account, context, maxDeposit, resolved };
}
/** Executes a credential plan and returns the concrete session credential payload. */
export async function executeCredentialPlan(plan, sink, autoSwap = false) {
    switch (plan.type) {
        case 'open':
            return open(plan, sink, autoSwap);
        case 'recover':
            return recover(plan, sink);
        case 'voucher':
            return voucher(plan, sink);
        case 'manual':
            return manual(plan, sink, autoSwap);
    }
}
async function resolveAutoSwapCalls(autoSwap, parameters) {
    if (!autoSwap)
        return undefined;
    return (await AutoSwap.findCalls(parameters.client, {
        account: parameters.account,
        amountOut: parameters.amountOut,
        tokenOut: parameters.tokenOut,
        tokenIn: autoSwap.tokenIn,
        slippage: autoSwap.slippage,
    }));
}
async function open(plan, sink, autoSwap) {
    const { account, resolved } = plan;
    const deposit = resolveOpeningDeposit({
        contextDepositRaw: plan.context?.depositRaw,
        maxDeposit: plan.maxDeposit,
        requestAmount: resolved.amount,
        suggestedDepositRaw: resolved.suggestedDepositRaw,
    });
    const payload = await createOpenPayload(resolved.client, account, {
        chainId: resolved.chainId,
        deposit,
        escrow: resolved.escrow,
        feePayer: resolved.feePayer,
        feeToken: resolved.feeToken,
        initialAmount: resolved.amount,
        operator: resolved.operator,
        payee: resolved.payee,
        prefixCalls: await resolveAutoSwapCalls(autoSwap, {
            account: account.address,
            amountOut: deposit,
            client: resolved.client,
            tokenOut: resolved.token,
        }),
        token: resolved.token,
    });
    await storeChannelEntry(sink, {
        channelId: payload.channelId,
        cumulativeAmount: resolved.amount,
        deposit,
        descriptor: payload.descriptor,
        escrow: resolved.escrow,
        chainId: resolved.chainId,
        opened: true,
    });
    return payload;
}
async function recover(plan, sink) {
    const { account, context, decimals, maxDeposit, resolved } = plan;
    const { descriptor } = context;
    const reusable = await resolveReusableChannel({
        channelId: context.channelId,
        client: resolved.client,
        descriptor,
        expected: {
            chainId: resolved.chainId,
            escrow: resolved.escrow,
            payee: resolved.payee,
            payer: account.address,
            authorizedSigner: resolveAuthorizedSigner(account),
            token: resolved.token,
        },
    });
    const cumulativeAmount = resolveRecoveredCumulative({
        context,
        decimals,
        requestAmount: resolved.amount,
        settled: reusable.state.settled,
        snapshot: resolved.snapshot,
    });
    if (cumulativeAmount > reusable.state.deposit)
        throw new Error('recovered voucher amount exceeds on-chain channel deposit');
    assertWithinMaxDeposit(cumulativeAmount, maxDeposit);
    const payload = await createVoucherPayload(resolved.client, account, descriptor, cumulativeAmount, resolved.chainId, resolved.escrow);
    await storeChannelEntry(sink, {
        channelId: reusable.channelId,
        cumulativeAmount,
        deposit: reusable.state.deposit,
        descriptor,
        escrow: resolved.escrow,
        chainId: resolved.chainId,
        opened: true,
    });
    return payload;
}
async function voucher(plan, sink) {
    const { account, entry, resolved } = plan;
    const cumulativeAmount = entry.cumulativeAmount + resolved.amount;
    assertWithinMaxDeposit(cumulativeAmount, plan.maxDeposit);
    const payload = await createVoucherPayload(resolved.client, account, entry.descriptor, cumulativeAmount, resolved.chainId, resolved.escrow);
    entry.cumulativeAmount = cumulativeAmount;
    await storeChannelEntry(sink, entry);
    return payload;
}
async function manual(plan, sink, autoSwap) {
    const { account, context, decimals, resolved } = plan;
    const { descriptor } = context;
    const channelId = Channel.computeId({
        ...descriptor,
        chainId: resolved.chainId,
        escrow: resolved.escrow,
    });
    assertReusableChannelDescriptor({
        channelId: context.channelId,
        descriptor,
        expectedChannelId: channelId,
        payee: resolved.payee,
        payer: account.address,
        authorizedSigner: resolveAuthorizedSigner(account),
        token: resolved.token,
    });
    const payload = await executeManualCredential({
        account,
        channelId,
        context,
        decimals,
        descriptor,
        resolved,
    }, autoSwap);
    await applyCumulative(sink, resolved.key, payload);
    return payload;
}
async function executeManualCredential(parameters, autoSwap) {
    switch (parameters.context.action) {
        case 'open':
            return manualOpen(parameters);
        case 'topUp':
            return manualTopUp(parameters, autoSwap);
        case 'voucher':
            return manualVoucher(parameters);
        case 'close':
            return manualClose(parameters);
    }
}
async function manualOpen(parameters) {
    const { account, channelId, context, decimals, descriptor, resolved } = parameters;
    if (!context.transaction)
        throw new Error('transaction required for open action');
    const cumulativeAmount = requireContextAmount(context, decimals, 'cumulativeAmount', 'open');
    const voucher = await createVoucherPayload(resolved.client, account, descriptor, cumulativeAmount, resolved.chainId, resolved.escrow);
    return {
        action: 'open',
        type: 'transaction',
        channelId,
        transaction: context.transaction,
        signature: voucher.signature,
        descriptor,
        cumulativeAmount: cumulativeAmount.toString(),
        authorizedSigner: descriptor.authorizedSigner,
    };
}
async function manualTopUp(parameters, autoSwap) {
    const { account, channelId, context, decimals, descriptor, resolved } = parameters;
    const additionalDeposit = requireContextAmount(context, decimals, 'additionalDeposit', 'topUp');
    if (context.transaction) {
        return {
            action: 'topUp',
            type: 'transaction',
            channelId,
            transaction: context.transaction,
            descriptor,
            additionalDeposit: additionalDeposit.toString(),
        };
    }
    return createTopUpPayload(resolved.client, account, descriptor, additionalDeposit, resolved.chainId, resolved.feePayer, resolved.escrow, await resolveAutoSwapCalls(autoSwap, {
        account: account.address,
        amountOut: additionalDeposit,
        client: resolved.client,
        tokenOut: resolved.token,
    }), resolved.feeToken);
}
function manualVoucher(parameters) {
    const { account, context, decimals, descriptor, resolved } = parameters;
    return createVoucherPayload(resolved.client, account, descriptor, requireContextAmount(context, decimals, 'cumulativeAmount', 'voucher'), resolved.chainId, resolved.escrow);
}
function manualClose(parameters) {
    const { account, context, decimals, descriptor, resolved } = parameters;
    return createClosePayload(resolved.client, account, descriptor, requireContextAmount(context, decimals, 'cumulativeAmount', 'close'), resolved.chainId, resolved.escrow);
}
//# sourceMappingURL=CredentialState.js.map