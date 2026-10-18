import { VerificationFailedError } from '../../Errors.js';
const initialPollIntervalMs = 10;
const maxPollIntervalMs = 250;
const preparedLeaseMs = 30_000;
function key(parameters) {
    return `mppx:charge:sponsor-budget:${parameters.chainId}:${parameters.sponsor.toLowerCase()}`;
}
function isState(value) {
    return value?.version === 1 && typeof value.reservations === 'object';
}
async function mutateOwned(store, handle, mutate) {
    return store.update(key(handle), (current) => {
        if (!isState(current))
            return { op: 'noop', result: false };
        const reservation = current.reservations[handle.id];
        if (!reservation || reservation.owner !== handle.owner)
            return { op: 'noop', result: false };
        const reservations = { ...current.reservations };
        const next = mutate(reservation);
        if (next)
            reservations[handle.id] = next;
        else
            delete reservations[handle.id];
        if (Object.keys(reservations).length === 0)
            return { op: 'delete', result: true };
        return {
            op: 'set',
            value: { reservations, version: 1 },
            result: true,
        };
    });
}
async function reconcile(store, parameters) {
    const state = await store.get(key(parameters));
    if (!isState(state))
        return;
    const now = Date.now();
    await Promise.all(Object.entries(state.reservations).map(async ([id, reservation]) => {
        const handle = {
            chainId: parameters.chainId,
            id,
            owner: reservation.owner,
            sponsor: parameters.sponsor,
        };
        if (reservation.expiresAt <= now ||
            (reservation.phase === 'prepared' && reservation.leaseUntil <= now)) {
            await release(store, handle);
            return;
        }
        // The broadcasting owner has submitted (or is about to submit) the
        // transaction but has not yet published that outcome to this store.
        // Releasing its reservation here races the owner's transition to
        // `pending`: the transaction can settle while the owner observes a lost
        // reservation and reports a retryable payment failure. Only reconcile
        // receipts after the owner has completed that hand-off.
        if (reservation.phase !== 'pending')
            return;
        try {
            await parameters.getReceipt(reservation.transactionHash);
        }
        catch {
            return;
        }
        await release(store, handle);
    }));
}
/**
 * Reserves aggregate sponsor fee capacity across processes.
 *
 * Pending broadcasts remain charged to the budget until a receipt is observed
 * or their expiring nonce becomes invalid. Capacity waiters do not rewrite the
 * shared state while waiting.
 *
 * @internal
 */
export async function reserve(store, parameters) {
    if (parameters.fee > parameters.maxTotalFee)
        throw new VerificationFailedError({
            reason: 'Sponsored transaction fee exceeds the aggregate sponsor budget',
        });
    let pollIntervalMs = initialPollIntervalMs;
    for (;;) {
        const now = Date.now();
        if (now >= parameters.waitUntil)
            throw new VerificationFailedError({
                reason: 'Sponsored transaction expired while waiting for sponsor budget',
            });
        await reconcile(store, parameters);
        const result = await store.update(key(parameters), (current) => {
            if (current !== null && !isState(current))
                return { op: 'noop', result: 'invalid' };
            const reservations = { ...(current?.reservations ?? {}) };
            const existing = reservations[parameters.id];
            if (existing)
                return { op: 'noop', result: 'duplicate' };
            const values = Object.values(reservations);
            const totalFee = values.reduce((total, reservation) => total + BigInt(reservation.fee), 0n);
            if (values.length >= parameters.maxReservations ||
                totalFee + parameters.fee > parameters.maxTotalFee)
                return { op: 'noop', result: 'wait' };
            reservations[parameters.id] = {
                expiresAt: parameters.expiresAt,
                fee: parameters.fee.toString(),
                leaseUntil: Math.min(parameters.expiresAt, now + preparedLeaseMs),
                owner: parameters.owner,
                phase: 'prepared',
                transactionHash: parameters.transactionHash,
            };
            return {
                op: 'set',
                value: { reservations, version: 1 },
                result: 'reserved',
            };
        });
        if (result === 'reserved')
            return parameters;
        if (result === 'invalid')
            throw new VerificationFailedError({
                reason: 'Sponsor budget store contains incompatible state',
            });
        if (result === 'duplicate')
            throw new VerificationFailedError({
                reason: 'Sponsored transaction already has a budget reservation',
            });
        await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, parameters.waitUntil - now)));
        pollIntervalMs = Math.min(pollIntervalMs * 2, maxPollIntervalMs);
    }
}
/**
 * Advances a reservation before and after the broadcast call.
 *
 * The owner token fences stale workers from mutating a replacement reservation.
 *
 * @internal
 */
export async function transition(store, handle, phase) {
    return mutateOwned(store, handle, (reservation) => ({
        ...reservation,
        phase,
    }));
}
/**
 * Releases a reservation only when the caller still owns it.
 *
 * @internal
 */
export async function release(store, handle) {
    return mutateOwned(store, handle, () => null);
}
//# sourceMappingURL=SponsorBudget.js.map