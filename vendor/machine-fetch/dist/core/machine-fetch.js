import { DisposedError } from './errors.js';
import { createBeforePayment } from './prepare.js';
import { neverAborted } from './time.js';
import { assertOperationId, assertPayer } from './validate.js';
/** Creates a paid Fetch function from any protocol client; `client` overrides `options.client`. */
export function machineFetchFrom(client, options = {}) {
    return machineFetch({ ...options, client });
}
/** Creates a Fetch-compatible client that prepares funds before payment signing. */
export function machineFetch(options) {
    const { payer } = options;
    if (payer !== undefined)
        assertPayer(payer);
    const funders = [...(options.funders ?? []), ...(options.client.funders ?? [])];
    const bound = options.client.bind({
        beforePayment: createBeforePayment({ ...options, funders }),
    });
    let disposed = false;
    const fetcher = (async (input, init) => {
        if (disposed)
            throw new DisposedError('machine-fetch wrapper was disposed');
        const operationId = init?.operationId === undefined ? crypto.randomUUID() : init.operationId;
        assertOperationId(operationId);
        return bound.fetch(input, init?.operationId === undefined ? init : withoutOperationId(init), Object.freeze({
            operationId,
            signal: requestSignal(input, init),
            ...(payer === undefined ? {} : { payer }),
        }));
    });
    Object.defineProperties(fetcher, {
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
/** Standard `RequestInit` members, which Fetch reads by property access. */
const requestInitKeys = [
    'body',
    'cache',
    'credentials',
    'duplex',
    'headers',
    'integrity',
    'keepalive',
    'method',
    'mode',
    'priority',
    'redirect',
    'referrer',
    'referrerPolicy',
    'signal',
    'window',
];
/**
 * A plain copy of `init` without `operationId`. Standard members are read by property access, as
 * Fetch reads them, so a `Request` or class-instance init keeps its inherited and accessor fields;
 * other own fields, such as Mppx's `context`, are kept too.
 */
function withoutOperationId(init) {
    const copy = {};
    for (const key of requestInitKeys) {
        const value = init[key];
        if (value !== undefined)
            copy[key] = value;
    }
    for (const [key, value] of Object.entries(init))
        if (key !== 'operationId')
            copy[key] = value;
    return copy;
}
/** The abort signal governing a Fetch call; an explicit `init.signal: null` opts out. */
export function requestSignal(input, init) {
    if (init?.signal === null)
        return neverAborted;
    return init?.signal ?? (input instanceof Request ? input.signal : neverAborted);
}
