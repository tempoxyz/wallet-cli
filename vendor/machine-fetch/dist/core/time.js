/** Current Unix time in whole seconds. */
export function nowSeconds() {
    return Math.floor(Date.now() / 1_000);
}
/** Milliseconds remaining until a Unix-seconds deadline, never negative. */
export function untilDeadline(deadline) {
    return Math.max(0, deadline * 1_000 - Date.now());
}
/** Stands in for an omitted signal, so cancellation paths need no undefined checks. */
export const neverAborted = new AbortController().signal;
/** Resolves after a delay, or rejects with the signal's reason when it aborts first. */
export function sleep(milliseconds, signal = neverAborted) {
    return new Promise((resolve, reject) => {
        if (signal.aborted)
            return reject(signal.reason);
        const abort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        }, milliseconds);
        signal.addEventListener('abort', abort, { once: true });
    });
}
/**
 * Runs work with a linked abort signal and settles when the work finishes, the timeout elapses, or
 * the outer signal aborts, whichever comes first. Late work results are ignored.
 */
export async function withTimeout(run, options) {
    const signal = options.signal ?? neverAborted;
    const abortError = options.abortError ?? ((reason) => reason);
    if (signal.aborted)
        throw abortError(signal.reason);
    const controller = new AbortController();
    let rejectEarly;
    const early = new Promise((_resolve, reject) => {
        rejectEarly = reject;
    });
    // Reject before aborting so work that rejects on abort cannot win the race.
    const abort = () => {
        rejectEarly(abortError(signal.reason));
        controller.abort(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
        const error = options.timeoutError();
        rejectEarly(error);
        controller.abort(error);
    }, options.milliseconds);
    try {
        return await Promise.race([run(controller.signal), early]);
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
    }
}
//# sourceMappingURL=time.js.map