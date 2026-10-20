import { FundingError, FundingRecoveryError } from '../core/errors.js';
import { immutableSnapshot } from '../core/immutable.js';
import { nowSeconds, sleep } from '../core/time.js';
import { isRecord } from '../core/validate.js';
/**
 * Submits only a newly claimed operation, then waits for provider completion. A claimed operation
 * that cannot be submitted (expired quote or cancellation) is released when the store supports it,
 * because nothing was broadcast; otherwise it stays claimed for reconciliation.
 */
export async function settleOperation(options) {
    let operation = immutableSnapshot(options.operation);
    const { route, store, signal } = options;
    let reference = operation.reference;
    if (options.submit) {
        // Checked synchronously before submit, so no await can let the quote expire in between.
        const failure = unsubmittable(operation, signal);
        if (failure)
            await releaseUnsubmitted(operation, store, failure);
    }
    try {
        if (options.submit) {
            const request = Object.freeze({ ...operation.request, signal });
            const result = await route.submit({ quote: operation.quote, request });
            const submitted = isRecord(result) ? result.reference : undefined;
            if (typeof submitted !== 'string' || !submitted.trim())
                throw new FundingError('Cross-chain submission has no reference');
            reference = submitted;
            // Persist even if cancellation arrived while the provider accepted the transfer.
            await store.setReference(operation.id, submitted);
            operation = immutableSnapshot({ ...operation, reference: submitted });
        }
        while (true) {
            signal.throwIfAborted();
            const result = await route.status(operation, { signal });
            signal.throwIfAborted();
            if (result.status === 'completed')
                return Object.freeze({
                    ...(reference === undefined ? {} : { reference }),
                    ...(typeof result.amountIn === 'bigint' ? { amountIn: result.amountIn } : {}),
                });
            if (result.status !== 'pending')
                throw new FundingError(`Cross-chain operation requires reconciliation: ${result.status}`);
            await sleep(options.pollIntervalMs, signal);
        }
    }
    catch (cause) {
        throw recoveryError(operation.id, reference, { cause });
    }
}
/** Funds may have moved for an operation; carries its provider reference when one is known. */
export function recoveryError(operationId, reference, options = {}) {
    return new FundingRecoveryError(operationId, 
    // Stryker disable next-line ConditionalExpression: an explicit undefined reference is stored exactly like an omitted one
    reference === undefined ? options : { ...options, reference });
}
/** Why a claimed operation must not be submitted now, if anything. */
function unsubmittable(operation, signal) {
    if (signal.aborted)
        return { reason: signal.reason };
    if (operation.quote.expiresAt <= nowSeconds())
        return { reason: new FundingError('Cross-chain quote expired before submission') };
    return undefined;
}
/** Releases a claim proven unsubmitted and rethrows its reason, or keeps it for reconciliation. */
async function releaseUnsubmitted(operation, store, failure) {
    if (!store.release)
        throw new FundingRecoveryError(operation.id, { cause: failure.reason });
    try {
        await store.release(operation.id);
    }
    catch (cause) {
        throw new FundingRecoveryError(operation.id, { cause });
    }
    throw failure.reason;
}
