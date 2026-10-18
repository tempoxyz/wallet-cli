import { MachineFetchError } from './errors.js';
import { createBeforePayment } from './prepare.js';
import { neverAborted } from './time.js';
import { assertAttemptId } from './validate.js';
/** Creates a Fetch-compatible client that prepares funds before payment signing. */
export function machineFetch(options) {
    const bound = options.client.bind({ beforePayment: createBeforePayment(options) });
    let disposed = false;
    const attempt = (attemptId) => async (input, init) => {
        if (disposed)
            throw new MachineFetchError('machine-fetch wrapper was disposed', { code: 'DISPOSED' });
        return bound.fetch(input, init, Object.freeze({ attemptId, signal: requestSignal(input, init) }));
    };
    const fetcher = ((input, init) => attempt(crypto.randomUUID())(input, init));
    Object.defineProperties(fetcher, {
        withAttempt: {
            value: (attemptId) => {
                assertAttemptId(attemptId);
                return attempt(attemptId);
            },
            enumerable: true,
        },
        raw: { value: bound.raw, enumerable: true },
        dispose: {
            value: () => {
                disposed = true;
                bound.dispose?.();
            },
            enumerable: true,
        },
    });
    return Object.freeze(fetcher);
}
/** The abort signal governing a Fetch call; an explicit `init.signal: null` opts out. */
export function requestSignal(input, init) {
    if (init?.signal === null)
        return neverAborted;
    return init?.signal ?? (input instanceof Request ? input.signal : neverAborted);
}
//# sourceMappingURL=machine-fetch.js.map