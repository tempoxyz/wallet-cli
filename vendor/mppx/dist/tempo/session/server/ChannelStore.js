import { AmountExceedsDepositError, ChannelClosedError, ChannelNotFoundError, DeltaTooSmallError, InvalidSignatureError, VerificationFailedError, } from '../../../Errors.js';
import { createSessionReceipt } from '../precompile/Protocol.js';
import { uint96 } from '../precompile/Protocol.js';
import * as Voucher from '../precompile/Voucher.js';
import { assertSameDescriptor, validateChannelDescriptor, validateChannelState, } from './CredentialVerification.js';
/** Returns whether a channel is backed by the TIP20EscrowChannel precompile. */
export function isPrecompileState(state) {
    return state.backend === 'precompile';
}
/** Returns the greater bigint value without decreasing persisted monotonic state. */
export function keepGreater(current, next) {
    return current > next ? current : next;
}
/** Returns the greater close-request timestamp as a bigint. */
export function keepGreaterTimestamp(current, next) {
    return keepGreater(current, BigInt(next));
}
/** Keeps local active-channel state in sync with authoritative on-chain reads. */
export function mergeActiveOnChainState(current, state) {
    return {
        closeRequestedAt: keepGreaterTimestamp(current?.closeRequestedAt ?? 0n, state.closeRequestedAt),
        deposit: keepGreater(current?.deposit ?? 0n, state.deposit),
        settledOnChain: keepGreater(current?.settledOnChain ?? 0n, state.settled),
    };
}
/** Keeps the existing higher voucher, otherwise stores the supplied candidate voucher. */
export function resolveHighestVoucher(parameters) {
    const { channelId, current, cumulativeAmount, signature } = parameters;
    if (current?.highestVoucherAmount && current.highestVoucherAmount > cumulativeAmount) {
        return {
            highestVoucherAmount: current.highestVoucherAmount,
            highestVoucher: current.highestVoucher,
        };
    }
    return {
        highestVoucherAmount: cumulativeAmount,
        highestVoucher: { channelId, cumulativeAmount, signature },
    };
}
/** Derives persisted identity fields from a verified precompile channel descriptor. */
export function resolvePrecompileChannelIdentity(parameters) {
    const { authorizedSigner, chainId, channelId, descriptor, escrow, expiringNonceHash } = parameters;
    return {
        authorizedSigner,
        backend: 'precompile',
        chainId,
        channelId,
        descriptor,
        escrowContract: escrow,
        expiringNonceHash,
        operator: descriptor.operator,
        payee: descriptor.payee,
        payer: descriptor.payer,
        salt: descriptor.salt,
        token: descriptor.token,
    };
}
/** Builds the persisted state for a verified precompile channel open. */
export function openChannelState(parameters) {
    const { authorizedSigner, chainId, channelId, current, descriptor, escrow, expiringNonceHash } = parameters;
    const { state } = parameters;
    const { cumulativeAmount, signature } = parameters;
    const highestVoucher = resolveHighestVoucher({
        channelId,
        current,
        cumulativeAmount,
        signature,
    });
    const onChain = mergeActiveOnChainState(current, state);
    return {
        ...(current ?? {}),
        ...resolvePrecompileChannelIdentity({
            authorizedSigner,
            chainId,
            channelId,
            descriptor,
            escrow,
            expiringNonceHash,
        }),
        closeRequestedAt: onChain.closeRequestedAt,
        deposit: onChain.deposit,
        settledOnChain: onChain.settledOnChain,
        highestVoucherAmount: highestVoucher.highestVoucherAmount,
        highestVoucher: highestVoucher.highestVoucher,
        spent: keepGreater(current?.spent ?? 0n, state.settled),
        units: current?.units ?? 0,
        finalized: current?.finalized ?? false,
        createdAt: current?.createdAt ?? new Date().toISOString(),
    };
}
/** Merges top-up on-chain state into persisted channel state without decreasing monotonic fields. */
export function topUpChannelState(parameters) {
    const { current, state } = parameters;
    if (!current)
        return current;
    return {
        ...current,
        ...mergeActiveOnChainState(current, state),
    };
}
/** Merges an accepted voucher into persisted channel state after signature and on-chain checks pass. */
export function acceptVoucherStateUpdate(parameters) {
    const { channelState, current, voucher } = parameters;
    if (!current)
        throw new ChannelNotFoundError({ reason: 'channel not found' });
    if (current.finalized)
        throw new ChannelClosedError({ reason: 'channel is finalized' });
    if (current.closeRequestedAt !== 0n)
        throw new ChannelClosedError({ reason: 'channel has a pending close request' });
    const onChain = mergeActiveOnChainState(current, channelState);
    if (voucher.cumulativeAmount <= current.highestVoucherAmount) {
        return { ...current, ...onChain };
    }
    return {
        ...current,
        ...onChain,
        highestVoucherAmount: voucher.cumulativeAmount,
        highestVoucher: voucher,
    };
}
/**
 * Resolves the close capture amount and validates it is covered by both the
 * close voucher and current on-chain deposit.
 */
export function resolveCloseCaptureAmount(parameters) {
    const { cumulativeAmount, onChainDeposit, onChainSettled, spent } = parameters;
    if (cumulativeAmount < spent) {
        throw new VerificationFailedError({
            reason: `close voucher amount must be >= ${spent} (spent)`,
        });
    }
    const captureAmount = uint96(spent > onChainSettled ? spent : onChainSettled);
    if (captureAmount > cumulativeAmount) {
        throw new VerificationFailedError({
            reason: `close voucher amount must be >= ${captureAmount} (capture amount)`,
        });
    }
    if (captureAmount > onChainDeposit) {
        throw new AmountExceedsDepositError({
            reason: 'close capture amount exceeds on-chain deposit',
        });
    }
    return captureAmount;
}
/** Marks local channel state as pending close and returns the bounded capture amount. */
export function markPendingClose(parameters) {
    const { closeRequestedAt, cumulativeAmount, current, onChainSettled, onChainDeposit } = parameters;
    if (!current)
        return { captureAmount: 0n, state: null };
    if (current.finalized)
        throw new ChannelClosedError({ reason: 'channel is already finalized' });
    if (current.closeRequestedAt !== 0n)
        throw new ChannelClosedError({ reason: 'channel has a pending close request' });
    const captureAmount = resolveCloseCaptureAmount({
        cumulativeAmount,
        onChainDeposit,
        onChainSettled,
        spent: current.spent,
    });
    return {
        captureAmount,
        state: { ...current, closeRequestedAt },
    };
}
/** Finalizes local channel state after a successful close transaction. */
export function finalizeClosedChannelState(parameters) {
    const { captureAmount, channelId, cumulativeAmount, current, signature } = parameters;
    if (!current)
        return current;
    const highestVoucher = resolveHighestVoucher({
        channelId,
        current,
        cumulativeAmount,
        signature,
    });
    return {
        ...current,
        finalized: true,
        closeRequestedAt: 0n,
        deposit: 0n,
        settledOnChain: keepGreater(current.settledOnChain, captureAmount),
        highestVoucherAmount: highestVoucher.highestVoucherAmount,
        highestVoucher: highestVoucher.highestVoucher,
    };
}
/** Loads a precompile-backed channel or throws a verification error. */
export async function loadPrecompileChannel(parameters) {
    const { channelId, chainId, descriptor, escrow, store } = parameters;
    const channel = await store.getChannel(channelId);
    if (!channel)
        throw new ChannelNotFoundError({ reason: 'channel not found' });
    if (!isPrecompileState(channel))
        throw new VerificationFailedError({ reason: 'channel is not precompile-backed' });
    assertSameDescriptor(descriptor, channel.descriptor);
    if (parameters.validateDescriptor)
        validateChannelDescriptor(descriptor, channelId, chainId, escrow, channel.payee, channel.token);
    return channel;
}
/** Verifies a cumulative voucher without changing persisted channel state. */
export async function validateVoucher(parameters) {
    const { minVoucherDelta, channel, voucher, channelState, methodDetails } = parameters;
    validateChannelState(channelState);
    if (voucher.cumulativeAmount > channelState.deposit)
        throw new AmountExceedsDepositError({ reason: 'voucher amount exceeds on-chain deposit' });
    if (voucher.cumulativeAmount < channel.highestVoucherAmount)
        throw new VerificationFailedError({
            reason: 'voucher cumulativeAmount must be strictly greater than highest accepted voucher',
        });
    const valid = await Voucher.verifyVoucher(methodDetails.escrowContract, methodDetails.chainId, voucher, channel.authorizedSigner);
    if (!valid)
        throw new InvalidSignatureError({ reason: 'invalid voucher signature' });
    if (voucher.cumulativeAmount <= channelState.settled)
        throw new VerificationFailedError({
            reason: 'voucher cumulativeAmount is below on-chain settled amount',
        });
    if (voucher.cumulativeAmount === channel.highestVoucherAmount)
        return { alreadyAccepted: true };
    const delta = voucher.cumulativeAmount - channel.highestVoucherAmount;
    if (delta < minVoucherDelta)
        throw new DeltaTooSmallError({
            reason: `voucher delta ${delta} below minimum ${minVoucherDelta}`,
        });
    return { alreadyAccepted: false };
}
/** Verifies a cumulative voucher and returns a session receipt after store reconciliation. */
export async function verifyAndAcceptVoucher(parameters) {
    const { store, challenge, channel, voucher, channelState, requireAdvance } = parameters;
    const validation = await validateVoucher(parameters);
    if (validation.alreadyAccepted) {
        if (requireAdvance)
            throw new DeltaTooSmallError({ reason: 'voucher does not add new funds for this request' });
        return createSessionReceipt({
            challengeId: challenge.id,
            channelId: voucher.channelId,
            acceptedCumulative: channel.highestVoucherAmount,
            spent: channel.spent,
            units: channel.units,
        });
    }
    const updated = await store.updateChannel(voucher.channelId, (current) => {
        if (requireAdvance &&
            current !== null &&
            voucher.cumulativeAmount <= current.highestVoucherAmount)
            throw new DeltaTooSmallError({ reason: 'voucher does not add new funds for this request' });
        return acceptVoucherStateUpdate({ channelState, current, voucher });
    });
    if (!updated)
        throw new ChannelNotFoundError({ reason: 'channel not found' });
    return createSessionReceipt({
        challengeId: challenge.id,
        channelId: voucher.channelId,
        acceptedCumulative: updated.highestVoucherAmount,
        spent: updated.spent,
        units: updated.units,
    });
}
/** Normalizes and validates 32-byte channel IDs before store lookup or persistence. */
export function normalizeChannelId(channelId) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(channelId))
        throw new Error('Invalid session channel ID.');
    return channelId.toLowerCase();
}
function normalizeState(channelId, state) {
    return state.channelId === channelId ? state : { ...state, channelId };
}
function normalizeMaybeState(channelId, state) {
    return state ? normalizeState(channelId, state) : null;
}
/** Normalizes any stored channel value inside a store change. */
function normalizeChange(channelId, change) {
    if (change.op !== 'set')
        return change;
    return {
        ...change,
        value: normalizeState(channelId, change.value),
    };
}
/**
 * Wraps a generic {@link Store} into the internal {@link Store}
 * interface used by server handlers and the SSE metering loop.
 *
 * Provides `waitForUpdate` notifications so the SSE `chargeOrWait` loop
 * can wake up without polling.
 *
 * ## Atomicity
 *
 * Mutations use `get` → `fn` → `set` guarded by a per-key in-process
 * mutex. This serializes concurrent `updateChannel` calls within a
 * single JS runtime but does **not** protect against races across
 * multiple processes or instances.
 *
 * Backends that need true atomicity (e.g., Durable Objects, D1)
 * should implement {@link Store} directly.
 */
const storeCache = new WeakMap();
/** Wraps a generic mppx store in the shared session channel-store interface. */
export function fromStore(store) {
    const cached = storeCache.get(store);
    if (cached)
        return cached;
    const stateStore = store;
    const atomicUpdate = stateStore.update;
    const runtime = {
        locks: new Map(),
        waiters: new Map(),
    };
    function notify(channelId) {
        const set = runtime.waiters.get(channelId);
        if (!set)
            return;
        for (const resolve of set)
            resolve();
        runtime.waiters.delete(channelId);
    }
    async function update(channelId, fn) {
        return updateResult(channelId, (current) => {
            const next = fn(current);
            if (next)
                return { op: 'set', value: next, result: next };
            return { op: 'delete', result: null };
        });
    }
    async function updateResult(channelId, fn) {
        const normalizedChannelId = normalizeChannelId(channelId);
        let change;
        if (atomicUpdate) {
            const result = await atomicUpdate(normalizedChannelId, (current) => {
                const normalizedCurrent = normalizeMaybeState(normalizedChannelId, current);
                change = normalizeChange(normalizedChannelId, fn(normalizedCurrent));
                return change;
            });
            if (change?.op !== 'noop')
                notify(normalizedChannelId);
            return result;
        }
        while (runtime.locks.has(normalizedChannelId))
            await runtime.locks.get(normalizedChannelId);
        let release;
        runtime.locks.set(normalizedChannelId, new Promise((r) => {
            release = r;
        }));
        try {
            const current = normalizeMaybeState(normalizedChannelId, await stateStore.get(normalizedChannelId));
            change = normalizeChange(normalizedChannelId, fn(current));
            if (change.op === 'set') {
                await stateStore.put(normalizedChannelId, change.value);
            }
            if (change.op === 'delete')
                await stateStore.delete(normalizedChannelId);
            if (change.op !== 'noop')
                notify(normalizedChannelId);
            return change.result;
        }
        finally {
            runtime.locks.delete(normalizedChannelId);
            release();
        }
    }
    const cs = {
        async getChannel(channelId) {
            const normalizedChannelId = normalizeChannelId(channelId);
            return normalizeMaybeState(normalizedChannelId, await stateStore.get(normalizedChannelId));
        },
        async updateChannel(channelId, fn) {
            return update(channelId, fn);
        },
        waitForUpdate(channelId) {
            return new Promise((resolve) => {
                const normalizedChannelId = normalizeChannelId(channelId);
                let set = runtime.waiters.get(normalizedChannelId);
                if (!set) {
                    set = new Set();
                    runtime.waiters.set(normalizedChannelId, set);
                }
                set.add(resolve);
            });
        },
    };
    cs.updateChannelResult = updateResult;
    storeCache.set(store, cs);
    return cs;
}
/**
 * Atomically deducts `amount` from a channel's available voucher balance.
 *
 * Returns `{ ok: true, channel }` with updated spend/unit counters when the
 * deduction succeeds. Returns `{ ok: false, channel }` without mutating state
 * when the channel exists but cannot currently be charged.
 */
export async function deductFromChannel(store, channelId, amount) {
    if (store.updateChannelResult) {
        const result = await store.updateChannelResult(channelId, (current) => planDeduction(current, amount));
        if (!result)
            throw new Error('channel not found');
        return result;
    }
    let result = null;
    const channel = await store.updateChannel(channelId, (current) => {
        const change = planDeduction(current, amount);
        result = change.result;
        if (change.op === 'set')
            return change.value;
        return current;
    });
    if (!channel)
        throw new Error('channel not found');
    return result ?? { ok: false, channel };
}
function planDeduction(current, amount) {
    if (!current)
        return { op: 'noop', result: null };
    if (current.finalized)
        return { op: 'noop', result: { ok: false, channel: current } };
    if (current.closeRequestedAt !== 0n)
        return { op: 'noop', result: { ok: false, channel: current } };
    if (current.highestVoucherAmount - current.spent < amount)
        return { op: 'noop', result: { ok: false, channel: current } };
    const next = { ...current, spent: current.spent + amount, units: current.units + 1 };
    return { op: 'set', value: next, result: { ok: true, channel: next } };
}
//# sourceMappingURL=ChannelStore.js.map