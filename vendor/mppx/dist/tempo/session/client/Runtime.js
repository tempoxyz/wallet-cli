import { parseUnits } from 'viem';
import * as Ws from '../precompile/Protocol.js';
export { deserializeSnapshot, serializeSnapshot } from '../Snapshot.js';
/** Initial state for a TIP-1034 session state machine. */
export const initialState = { status: 'idle' };
/** Constructs the canonical active state shape for the reducer and transport drivers. */
export function createActiveState(parameters) {
    return { status: 'active', ...parameters };
}
/** Applies a state-machine event and returns the next state plus requested effects. */
export function reduce(state, event) {
    switch (event.type) {
        case 'challengeReceived':
            if (state.status === 'closing' || state.status === 'closed')
                return invalid(state, event);
            return {
                state: { status: 'challenged', challengeId: event.challengeId },
                effects: [],
            };
        case 'challenge': {
            if (state.status !== 'idle' && state.status !== 'active')
                return invalid(state, event);
            if (event.snapshot) {
                return {
                    state: { status: 'hydrating', challengeId: event.challengeId, snapshot: event.snapshot },
                    effects: [{ type: 'hydrate', snapshot: event.snapshot }],
                };
            }
            return {
                state: { status: 'opening', challengeId: event.challengeId },
                effects: [{ type: 'open' }],
            };
        }
        case 'hydrated':
            if (state.status !== 'hydrating')
                return invalid(state, event);
            return {
                state: activeFromSnapshot(state.challengeId, event.snapshot),
                effects: [],
            };
        case 'activated':
            if (state.status === 'closing' || state.status === 'closed')
                return invalid(state, event);
            return {
                state: activeStateFromChannel({
                    challengeId: event.challengeId,
                    entry: event.entry,
                    spent: event.spent,
                    units: event.units ?? 0,
                }),
                effects: [],
            };
        case 'opened':
            if (state.status !== 'opening')
                return invalid(state, event);
            return {
                state: activeFromReceipt(state.challengeId, event.receipt, event.descriptor, event.deposit),
                effects: [],
            };
        case 'receiptAccepted':
            if (state.status === 'closing' || state.status === 'closed')
                return invalid(state, event);
            return {
                state: activeStateFromReceipt(event.receipt, event.entry),
                effects: [],
            };
        case 'needVoucher': {
            if (state.status !== 'active')
                return invalid(state, event);
            return resolveNeedVoucherTransition({
                challengeId: state.challengeId,
                descriptor: event.descriptor,
                event: event.event,
            });
        }
        case 'topUpStarted':
            if (state.status !== 'voucherNeeded')
                return invalid(state, event);
            return {
                state: {
                    status: 'toppingUp',
                    challengeId: state.challengeId,
                    channelId: state.channelId,
                    descriptor: state.descriptor,
                    deposit: state.deposit,
                },
                effects: [],
            };
        case 'voucherAccepted':
            if (state.status !== 'voucherNeeded' && state.status !== 'toppingUp')
                return invalid(state, event);
            return {
                state: activeFromReceipt(state.challengeId, event.receipt, state.descriptor, event.deposit ?? state.deposit),
                effects: [],
            };
        case 'settleStarted':
            if (state.status !== 'active')
                return invalid(state, event);
            return {
                state: {
                    status: 'settling',
                    channelId: state.channelId,
                    descriptor: state.descriptor,
                    deposit: state.deposit,
                },
                effects: [{ type: 'settle', channelId: state.channelId }],
            };
        case 'settled':
            if (state.status !== 'settling')
                return invalid(state, event);
            return {
                state: activeFromReceipt(event.receipt.challengeId, event.receipt, state.descriptor, event.deposit ?? state.deposit),
                effects: [],
            };
        case 'closeRequested':
            if (state.status !== 'active')
                return invalid(state, event);
            return {
                state: {
                    status: 'closeRequested',
                    channelId: state.channelId,
                    descriptor: state.descriptor,
                },
                effects: [{ type: 'requestClose', channelId: state.channelId }],
            };
        case 'withdrawable':
            if (state.status !== 'closeRequested')
                return invalid(state, event);
            return {
                state: { status: 'withdrawable', channelId: state.channelId, descriptor: state.descriptor },
                effects: [{ type: 'withdraw', channelId: state.channelId }],
            };
        case 'closeStarted':
            if (state.status !== 'active' &&
                state.status !== 'withdrawable' &&
                state.status !== 'closeRequested')
                return invalid(state, event);
            return {
                state: { status: 'closing', channelId: state.channelId, descriptor: state.descriptor },
                effects: [{ type: 'close', channelId: state.channelId }],
            };
        case 'closed':
            if (state.status !== 'closing' && state.status !== 'withdrawable')
                return invalid(state, event);
            return {
                state: { status: 'closed', channelId: state.channelId, descriptor: state.descriptor },
                effects: [],
            };
    }
}
/** Applies a reducer event to mutable manager runtime state. */
export function dispatchSessionEvent(runtime, event) {
    const transition = reduce(runtime.state, event);
    runtime.state = transition.state;
    return transition;
}
/** Decides whether a need-voucher event can be answered by voucher or requires top-up first. */
export function resolveNeedVoucherTransition(parameters) {
    const { challengeId, descriptor, event } = parameters;
    const required = BigInt(event.requiredCumulative);
    const deposit = BigInt(event.deposit);
    if (required > deposit) {
        return {
            state: {
                status: 'toppingUp',
                challengeId,
                channelId: event.channelId,
                descriptor,
                deposit: event.deposit,
            },
            effects: [
                { type: 'topUp', channelId: event.channelId, amount: (required - deposit).toString() },
            ],
        };
    }
    return {
        state: {
            status: 'voucherNeeded',
            challengeId,
            channelId: event.channelId,
            descriptor,
            requiredCumulative: event.requiredCumulative,
            deposit: event.deposit,
        },
        effects: [{ type: 'voucher' }],
    };
}
function activeFromSnapshot(challengeId, snapshot) {
    return createActiveState({
        challengeId,
        channelId: snapshot.channelId,
        descriptor: snapshot.descriptor,
        acceptedCumulative: snapshot.acceptedCumulative,
        deposit: snapshot.deposit,
        spent: snapshot.spent,
        units: snapshot.units ?? 0,
    });
}
function activeFromReceipt(challengeId, receipt, descriptor, deposit) {
    return createActiveState({
        challengeId,
        channelId: receipt.channelId,
        descriptor,
        acceptedCumulative: receipt.acceptedCumulative,
        deposit,
        spent: receipt.spent,
        units: receipt.units ?? 0,
    });
}
function invalid(state, event) {
    throw new Error(`Invalid session transition: ${state.status} + ${event.type}`);
}
/** Throws when a cumulative voucher amount exceeds the caller's local cap. */
export function assertVoucherWithinLocalLimit(parameters) {
    const { cumulativeAmount, maxVoucherCumulative } = parameters;
    if (maxVoucherCumulative === null)
        return;
    if (cumulativeAmount <= maxVoucherCumulative)
        return;
    throw new Error(`requested voucher amount ${cumulativeAmount} exceeds local maxDeposit ${maxVoucherCumulative}`);
}
/** Validates a server receipt without allowing it to increase the local signing boundary. */
export function assertReceiptWithinLocalState(parameters) {
    const { channel, maxVoucherCumulative, receipt } = parameters;
    if (!channel || receipt.channelId !== channel.channelId)
        return;
    const acceptedCumulative = BigInt(receipt.acceptedCumulative);
    const receiptSpent = BigInt(receipt.spent);
    if (receiptSpent > acceptedCumulative) {
        throw new Error('receipt spent exceeds accepted cumulative voucher amount');
    }
    if (acceptedCumulative > channel.cumulativeAmount) {
        throw new Error('receipt accepted cumulative exceeds local voucher state');
    }
    if (receiptSpent > channel.cumulativeAmount) {
        throw new Error('receipt spent exceeds local voucher state');
    }
    assertVoucherWithinLocalLimit({ cumulativeAmount: acceptedCumulative, maxVoucherCumulative });
    assertVoucherWithinLocalLimit({ cumulativeAmount: receiptSpent, maxVoucherCumulative });
}
/** Returns the monotonic next local spend after validating an optional receipt. */
export function nextSpentFromReceipt(parameters) {
    const { channel, maxVoucherCumulative, receipt, spent } = parameters;
    if (!receipt || receipt.channelId !== channel?.channelId)
        return spent;
    assertReceiptWithinLocalState({ channel, maxVoucherCumulative, receipt });
    const next = BigInt(receipt.spent);
    return spent > next ? spent : next;
}
/** Parses a manager amount. Bigints are raw units; strings are parsed using token decimals. */
export function parseManagerAmount(amount, decimals) {
    if (typeof amount === 'bigint')
        return amount;
    return parseUnits(amount, decimals);
}
/** Resolves the opening deposit from explicit context, server hint, request amount, and local cap. */
export function resolveOpeningDeposit(parameters) {
    const { contextDepositRaw, maxDeposit, requestAmount, suggestedDepositRaw } = parameters;
    assertWithinMaxDeposit(requestAmount, maxDeposit);
    if (contextDepositRaw !== undefined) {
        const deposit = BigInt(contextDepositRaw);
        if (deposit < requestAmount) {
            throw new Error(`opening deposit ${deposit} below request amount ${requestAmount}`);
        }
        return deposit;
    }
    const suggestedDeposit = suggestedDepositRaw !== undefined ? BigInt(suggestedDepositRaw) : undefined;
    const proposed = suggestedDeposit !== undefined && suggestedDeposit > requestAmount
        ? suggestedDeposit
        : requestAmount;
    if (maxDeposit !== undefined)
        return proposed < maxDeposit ? proposed : maxDeposit;
    return proposed;
}
/** Resolves a bounded automatic refill, preferring explicit policy over server headroom. */
export function resolveAutomaticTopUp(parameters) {
    const { deposit, maxDeposit, requiredCumulative, suggestedDeposit, topUpAmount } = parameters;
    if (requiredCumulative <= deposit)
        return 0n;
    assertVoucherWithinLocalLimit({
        cumulativeAmount: requiredCumulative,
        maxVoucherCumulative: maxDeposit ?? null,
    });
    const shortfall = requiredCumulative - deposit;
    const preferred = topUpAmount ?? suggestedDeposit ?? shortfall;
    const proposed = preferred > shortfall ? preferred : shortfall;
    if (maxDeposit === null || maxDeposit === undefined)
        return proposed;
    const remaining = maxDeposit - deposit;
    return proposed < remaining ? proposed : remaining;
}
/** Enforces the optional client-side maximum cumulative voucher authorization. */
export function assertWithinMaxDeposit(cumulativeAmount, maxDeposit) {
    assertVoucherWithinLocalLimit({
        cumulativeAmount,
        maxVoucherCumulative: maxDeposit ?? null,
    });
}
/** Resolves the currently closeable channel and challenge, or undefined when no channel is open. */
export function resolveCloseTarget(parameters) {
    const { channel, currentSocket, lastChallenge } = parameters;
    if (!channel?.opened)
        return undefined;
    const challenge = currentSocket?.challenge ?? lastChallenge;
    const channelId = currentSocket?.channelId ?? channel.channelId;
    if (!challenge) {
        throw new Error('Cannot close session: no challenge available. This usually means close() was called on a SessionManager instance that was recreated after the session was opened. Use the same SessionManager instance that opened the session, or make a request first to receive a fresh 402 challenge.');
    }
    if (!channelId) {
        throw new Error('Cannot close session: no channel ID available. The session may not have been fully opened.');
    }
    return { challenge, channel, channelId };
}
/** Highest spend the client may sign for during close based on local receipts and vouchers. */
export function localCloseSpendLimit(parameters) {
    const { cumulativeAmount, spent } = parameters;
    return cumulativeAmount > spent ? cumulativeAmount : spent;
}
/** Throws when a close-ready receipt asks the client to sign beyond local state. */
export function assertCloseReadyWithinLocalState(parameters) {
    const { cumulativeAmount, readySpent, spent } = parameters;
    if (!Ws.isUint96(readySpent))
        throw new Error('close-ready spent is not a uint96 amount');
    if (readySpent < spent)
        throw new Error('close-ready spent is below locally confirmed spend');
    if (readySpent > localCloseSpendLimit({ cumulativeAmount, spent })) {
        throw new Error('close-ready spent exceeds local voucher state');
    }
}
/** Returns whether a receipt is the expected final close settlement receipt. */
export function isExpectedCloseReceipt(parameters) {
    const { challengeId, channelId, expectedCloseAmount, minimumSpent = 0n, receipt } = parameters;
    const expected = Ws.parseUint96Amount(expectedCloseAmount);
    const receiptSpent = Ws.parseUint96Amount(receipt.spent);
    if (expected === undefined || receiptSpent === undefined || !Ws.isUint96(minimumSpent))
        return false;
    return (Boolean(receipt.txHash) &&
        receipt.challengeId === challengeId &&
        receipt.channelId === channelId &&
        receipt.acceptedCumulative === expectedCloseAmount &&
        receiptSpent >= minimumSpent &&
        receiptSpent <= expected);
}
/** Projects cached channel data into an active state-machine state. */
export function activeStateFromChannel(parameters) {
    return createActiveState({
        challengeId: parameters.challengeId,
        channelId: parameters.entry.channelId,
        descriptor: parameters.entry.descriptor,
        acceptedCumulative: parameters.entry.cumulativeAmount.toString(),
        deposit: parameters.entry.deposit.toString(),
        spent: parameters.spent,
        units: parameters.units,
    });
}
/** Creates the initial mutable runtime state for an auto-driving session manager. */
export function createSessionManagerRuntime() {
    return {
        channel: null,
        lastChallenge: null,
        lastUrl: null,
        spent: 0n,
        socketSession: null,
        state: initialState,
    };
}
/** Validates a receipt, advances observed spend, and projects matching receipts into public state. */
export function applySessionReceiptToRuntime(parameters) {
    const { maxVoucherCumulative, receipt, runtime } = parameters;
    runtime.spent = nextSpentFromReceipt({
        channel: runtime.channel,
        maxVoucherCumulative,
        receipt,
        spent: runtime.spent,
    });
    if (receipt && runtime.channel?.channelId === receipt.channelId) {
        dispatchSessionEvent(runtime, {
            type: 'receiptAccepted',
            receipt,
            entry: runtime.channel,
        });
    }
}
/** Projects a verified receipt plus local descriptor/deposit data into an active state-machine state. */
export function activeStateFromReceipt(receipt, entry) {
    return createActiveState({
        challengeId: receipt.challengeId,
        channelId: receipt.channelId,
        descriptor: entry.descriptor,
        acceptedCumulative: receipt.acceptedCumulative,
        deposit: entry.deposit.toString(),
        spent: receipt.spent,
        units: receipt.units ?? 0,
    });
}
/** Projects a closed channel into the public closed state-machine state. */
export function closedStateFromChannel(parameters) {
    return {
        status: 'closed',
        channelId: parameters.channelId,
        descriptor: parameters.entry.descriptor,
    };
}
/** Projects a final close receipt into the public closed state-machine state. */
export function closedStateFromReceipt(receipt, entry) {
    return closedStateFromChannel({ channelId: receipt.channelId, entry });
}
/**
 * Computes the fallback close amount without authorizing more than the local cumulative voucher.
 *
 * Priority:
 * 1. Matching close-ready receipt spend.
 * 2. Matching socket delivery estimate (`deliveredChunks * tickCost`) clamped by cumulative.
 * 3. Local cumulative authorization high-water mark for HTTP/SSE.
 */
export function computeFallbackCloseAmount(parameters) {
    const { challengeId, channelId, closeReadyReceipt, cumulativeAmount, deliveredChunks = 0n, socketChallengeId, socketChannelId, spent, tickCost = 0n, } = parameters;
    if (spent > cumulativeAmount) {
        throw new Error('locally confirmed spend exceeds local voucher state');
    }
    if (closeReadyReceipt &&
        closeReadyReceipt.challengeId === challengeId &&
        closeReadyReceipt.channelId === channelId) {
        const closeReadySpent = Ws.parseUint96Amount(closeReadyReceipt.spent);
        if (closeReadySpent === undefined)
            throw new Error('close-ready spent is not a uint96 amount');
        return closeReadySpent > spent ? closeReadySpent : spent;
    }
    if (socketChallengeId === challengeId && socketChannelId === channelId && tickCost > 0n) {
        const deliveryEstimate = deliveredChunks * tickCost;
        const bestSpent = spent > deliveryEstimate ? spent : deliveryEstimate;
        return bestSpent > cumulativeAmount ? cumulativeAmount : bestSpent;
    }
    return cumulativeAmount;
}
/**
 * Restores a channel's cumulative voucher boundary and returns the refreshed active state.
 *
 * Returns `undefined` when the active channel does not match or no challenge is
 * available to label the active state.
 */
export function restoreCumulativeAuthorization(parameters) {
    const { channel, channelId, challengeId, cumulativeAmount, spent, state } = parameters;
    if (!channel || channel.channelId !== channelId)
        return undefined;
    channel.cumulativeAmount = cumulativeAmount;
    if (!challengeId)
        return undefined;
    return reduce(state, {
        type: 'activated',
        challengeId,
        entry: channel,
        spent: spent.toString(),
        units: state.status === 'active' ? state.units : 0,
    }).state;
}
/** Captures mutable session runtime fields before an optimistic manager action. */
export function captureRuntimeSnapshot(runtime) {
    return {
        channel: runtime.channel === null
            ? null
            : {
                entry: runtime.channel,
                cumulativeAmount: runtime.channel.cumulativeAmount,
                deposit: runtime.channel.deposit,
                opened: runtime.channel.opened,
            },
        spent: runtime.spent,
        state: runtime.state,
    };
}
/** Restores mutable session runtime fields from a previous snapshot. */
export function restoreRuntimeSnapshot(snapshot, currentChannel) {
    if (snapshot.channel) {
        snapshot.channel.entry.cumulativeAmount = snapshot.channel.cumulativeAmount;
        snapshot.channel.entry.deposit = snapshot.channel.deposit;
        snapshot.channel.entry.opened = snapshot.channel.opened;
        return {
            channel: snapshot.channel.entry,
            spent: snapshot.spent,
            state: snapshot.state,
        };
    }
    if (currentChannel)
        currentChannel.opened = false;
    return {
        channel: null,
        spent: snapshot.spent,
        state: snapshot.state,
    };
}
/** Cooperatively closes an active paid WebSocket session and returns the final receipt. */
export async function closeSocketSession(parameters) {
    const { activeSocket, currentSocket, target } = parameters;
    const ready = currentSocket.closeReadyReceipt ??
        (await (async () => {
            activeSocket.send(Ws.formatCloseRequestMessage());
            return parameters.waitForCloseReady();
        })());
    const readySpent = BigInt(ready.spent);
    assertCloseReadyWithinLocalState({
        cumulativeAmount: target.channel.cumulativeAmount,
        readySpent,
        spent: parameters.spent,
    });
    const credential = await parameters.createSessionCredential(target.challenge, {
        action: 'close',
        channelId: target.channelId,
        descriptor: target.channel.descriptor,
        cumulativeAmountRaw: readySpent.toString(),
    });
    const expectedCloseAmount = readySpent.toString();
    currentSocket.expectedCloseAmount = expectedCloseAmount;
    try {
        const pendingReceipt = parameters.waitForReceipt((receipt) => isExpectedCloseReceipt({
            challengeId: target.challenge.id,
            channelId: target.channelId,
            expectedCloseAmount,
            minimumSpent: readySpent,
            receipt,
        }));
        activeSocket.send(Ws.formatAuthorizationMessage(credential));
        const receipt = await pendingReceipt;
        activeSocket.close();
        currentSocket.closeReadyReceipt = null;
        return receipt;
    }
    finally {
        currentSocket.expectedCloseAmount = null;
    }
}
//# sourceMappingURL=Runtime.js.map