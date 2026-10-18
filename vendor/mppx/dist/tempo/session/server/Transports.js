import { ChannelClosedError } from '../../../Errors.js';
/**
 * Reserves voucher headroom for a future stream emission.
 *
 * If the channel lacks headroom, emits one need-voucher frame, then waits for
 * a store update or polling interval until the accepted voucher covers both
 * already-reserved charges and the next requested amount.
 */
export async function reserveChargeOrWait(options) {
    const { amount, channelId, emit, formatNeedVoucher, pollIntervalMs, reservedAmount, signal, store, } = options;
    let channel = await store.getChannel(channelId);
    if (!channel)
        throw new Error('channel not found');
    throwIfChannelClosed(channel);
    const hasHeadroom = (state) => state.highestVoucherAmount - state.spent - reservedAmount >= amount;
    if (hasHeadroom(channel))
        return;
    await Promise.resolve(emit(formatNeedVoucher({
        channelId,
        requiredCumulative: (channel.spent + reservedAmount + amount).toString(),
        acceptedCumulative: channel.highestVoucherAmount.toString(),
        deposit: channel.deposit.toString(),
    })));
    while (!hasHeadroom(channel)) {
        await waitForUpdate(store, channelId, pollIntervalMs, signal);
        channel = await store.getChannel(channelId);
        if (!channel)
            throw new Error('channel not found');
        throwIfChannelClosed(channel);
    }
}
/** Atomically commits previously reserved stream charges to channel spend and unit counters. */
export async function commitReservedCharges(options) {
    const { amount, channelId, store, units } = options;
    if (amount === 0n || units === 0)
        return;
    let committed = false;
    const channel = await store.updateChannel(channelId, (current) => {
        if (!current)
            return null;
        if (current.finalized)
            return current;
        if (current.closeRequestedAt !== 0n)
            return current;
        if (current.highestVoucherAmount - current.spent < amount)
            return current;
        committed = true;
        return {
            ...current,
            spent: current.spent + amount,
            units: current.units + units,
        };
    });
    if (!channel)
        throw new Error('channel not found');
    throwIfChannelClosed(channel);
    if (!committed)
        throw new Error('reserved voucher coverage is no longer available');
    return channel;
}
/** Throws when a channel can no longer be used for streaming charges. */
export function throwIfChannelClosed(channel) {
    if (channel.finalized)
        throw new ChannelClosedError({ reason: 'channel is finalized' });
    if (channel.closeRequestedAt !== 0n)
        throw new ChannelClosedError({ reason: 'channel has a pending close request' });
}
async function waitForUpdate(store, channelId, pollIntervalMs, signal) {
    throwIfAborted(signal);
    if (store.waitForUpdate) {
        await Promise.race([
            store.waitForUpdate(channelId),
            sleep(pollIntervalMs, signal),
            ...(signal ? [onceAborted(signal)] : []),
        ]);
    }
    else {
        await sleep(pollIntervalMs, signal);
    }
    throwIfAborted(signal);
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timeout);
            reject(signal?.reason ?? new Error('aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
function onceAborted(signal) {
    return new Promise((_, reject) => {
        if (signal.aborted) {
            reject(signal.reason ?? new Error('aborted'));
            return;
        }
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
            once: true,
        });
    });
}
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw signal.reason ?? new Error('aborted');
}
/** Subscribes to browser or Node-style socket events and returns an unsubscribe callback. */
export function subscribe(socket, handlers) {
    if (socket.addEventListener && socket.removeEventListener) {
        const onMessage = (event) => handlers.message('data' in event ? event.data : undefined);
        socket.addEventListener('message', onMessage);
        socket.addEventListener('close', handlers.close);
        socket.addEventListener('error', handlers.error);
        return () => {
            socket.removeEventListener?.('message', onMessage);
            socket.removeEventListener?.('close', handlers.close);
            socket.removeEventListener?.('error', handlers.error);
        };
    }
    if (socket.on && socket.off) {
        const onMessage = (data) => handlers.message(data);
        socket.on('message', onMessage);
        socket.on('close', handlers.close);
        socket.on('error', handlers.error);
        return () => {
            socket.off?.('message', onMessage);
            socket.off?.('close', handlers.close);
            socket.off?.('error', handlers.error);
        };
    }
    throw new Error('unsupported websocket implementation');
}
/** Sends a text frame through sync or async socket implementations. */
export async function send(socket, data) {
    await Promise.resolve(socket.send(data));
}
/** Converts socket message payloads into text frames when possible. */
export function toText(value) {
    if (typeof value === 'string')
        return value;
    if (value instanceof ArrayBuffer)
        return new TextDecoder().decode(value);
    if (ArrayBuffer.isView(value))
        return new TextDecoder().decode(value);
    return null;
}
//# sourceMappingURL=Transports.js.map