import * as Challenge from '../../Challenge.js';
import * as Constants from '../../Constants.js';
import * as Expires from '../../Expires.js';
import * as AcceptPayment from '../../internal/AcceptPayment.js';
import * as Transport from '../Transport.js';
import * as MethodChallenge from './MethodChallenge.js';
import * as MethodResponse from './MethodResponse.js';
// We tag wrappers with a global symbol so we can recognize wrappers created by mppx,
// even across multiple module instances/bundles. This lets restore() avoid clobbering
// an unrelated fetch installed by user code or another library.
const MPPX_FETCH_WRAPPER = Symbol.for('mppx.fetch.wrapper');
const defaultMaxPaymentRetries = 3;
let originalFetch;
const eventObserverChecks = new WeakMap();
async function settleAttempt(prepared, outcome) {
    const settle = prepared?.attempt.settle;
    if (!settle)
        return outcome.status !== 'pending';
    prepared.attempt.settle = undefined;
    const settled = await settle(outcome);
    if (!settled)
        prepared.attempt.settle = settle;
    return settled;
}
/**
 * Creates a fetch wrapper that automatically handles 402 Payment Required responses.
 *
 * @example
 * ```ts
 * import { Fetch, tempo } from 'mppx/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const fetch = Fetch.from({
 *   methods: [
 *     tempo({
 *       account: privateKeyToAccount('0x...'),
 *     }),
 *   ],
 * })
 *
 * // Use the wrapped fetch — handles 402 automatically
 * const res = await fetch('https://api.example.com/resource')
 * ```
 *
 */
export function from(config) {
    const { acceptPayment, acceptPaymentPolicy = 'always', fetch = globalThis.fetch, maxPaymentRetries = defaultMaxPaymentRetries, methods, onChallenge, orderChallenges, transport = Transport.http(), } = config;
    const events = config.eventDispatcher ?? createEventDispatcher();
    const resolvedAcceptPayment = acceptPayment ?? AcceptPayment.resolve(methods);
    // Always operate on the true underlying fetch to avoid wrapper-on-wrapper stacking,
    // which can duplicate retries and make restore semantics fragile.
    const baseFetch = unwrapFetch(fetch);
    const request = async (input, init, canRefetch) => {
        const callerHeaders = getCallerHeaders(input, init?.headers);
        const hasExplicitAcceptPayment = callerHeaders.has(Constants.Headers.acceptPayment);
        const paymentPreferences = resolvePaymentPreferences(callerHeaders, resolvedAcceptPayment);
        const capturedBody = captureRequestBody(input, init, callerHeaders);
        const initialRequest = prepareInitialRequest(input, init, callerHeaders, paymentPreferences.header, hasExplicitAcceptPayment, acceptPaymentPolicy);
        let response = await baseFetch(cloneRequestInput(initialRequest.input), initialRequest.init);
        const transportRequest = withCapturedBody(initialRequest.init, await capturedBody);
        if (!(await transport.isPaymentRequired(response, transportRequest)))
            return response;
        // Only extract context for payment handling after confirming 402.
        const context = init?.context;
        const { context: _, orderChallenges: requestOrderChallenges, ...fetchInit } = (transportRequest ?? {});
        let challenge;
        let challenges;
        let mi;
        let preparedCredential;
        try {
            for (let retry = 0; retry < maxPaymentRetries; retry++) {
                challenges = await transport.getChallenges(response, transportRequest);
                const candidates = AcceptPayment.selectChallengeCandidates(challenges, methods, paymentPreferences.entries);
                const orderedCandidates = await resolveChallengeOrder(candidates, requestOrderChallenges ??
                    orderChallenges);
                const selected = orderedCandidates[0];
                if (!selected) {
                    await settleAttempt(preparedCredential, {
                        challenges,
                        response,
                        status: 'rejected',
                    });
                    // A post-payment 402 with no actionable challenge (e.g. rejected credential)
                    // is the server's final answer, not a new challenge round.
                    if (retry > 0)
                        return response;
                    throw new Error(`No method found for challenges: ${challenges.map((c) => `${c.method}.${c.intent}`).join(', ')}. Available: ${methods.map((m) => `${m.name}.${m.intent}`).join(', ')}`);
                }
                const selectedChallenge = selected.challenge;
                challenge = selectedChallenge;
                mi = selected.method;
                if (challenge.expires)
                    Expires.assert(challenge.expires, challenge.id);
                const paymentInput = resolvePaymentRetryInput(response, initialRequest.input, initialRequest.input);
                const previousCredential = preparedCredential;
                const key = Challenge.serialize(selectedChallenge);
                const sameAttempt = previousCredential?.method === selected.method && previousCredential?.key === key;
                let canReusePrevious = false;
                if (previousCredential) {
                    const settled = await settleAttempt(previousCredential, {
                        challenges,
                        response,
                        status: sameAttempt ? 'pending' : 'rejected',
                    });
                    canReusePrevious = sameAttempt && !settled;
                }
                preparedCredential = canReusePrevious ? previousCredential : undefined;
                const createCredential = memoizeCreateCredential(async (overrideContext) => {
                    if (overrideContext === undefined && canReusePrevious && previousCredential) {
                        return previousCredential.promise;
                    }
                    if (canReusePrevious && previousCredential) {
                        await settleAttempt(previousCredential, { status: 'rejected' });
                        preparedCredential = undefined;
                    }
                    const credentialContext = overrideContext ?? context;
                    if (!MethodChallenge.has(selected.method))
                        return resolveCredential(selectedChallenge, selected.method, credentialContext);
                    const attempt = {
                        prepare: () => MethodChallenge.handle(selected.method, {
                            challenge: selectedChallenge,
                            context: credentialContext,
                            fetch: baseFetch,
                            input: paymentInput,
                        }),
                    };
                    const promise = attempt
                        .prepare()
                        .then(() => resolveCredential(selectedChallenge, selected.method, credentialContext, attempt));
                    preparedCredential = {
                        attempt,
                        key: overrideContext === undefined ? key : undefined,
                        method: selected.method,
                        promise,
                    };
                    return promise;
                });
                const eventCredential = await events.emit('challenge.received', createChallengeReceivedPayload({
                    challenge: selectedChallenge,
                    challenges,
                    createCredential,
                    init,
                    input,
                    method: selected.method,
                    response,
                }));
                const onChallengeCredential = eventCredential ??
                    (onChallenge
                        ? await onChallenge(challenge, {
                            createCredential,
                        })
                        : undefined);
                const credential = onChallengeCredential ?? (await createCredential());
                const prepared = preparedCredential;
                if (prepared && (await prepared.promise.catch(() => undefined)) !== credential) {
                    await settleAttempt(prepared, { status: 'rejected' });
                    preparedCredential = undefined;
                }
                validateCredentialHeaderValue(credential);
                await events.emit('credential.created', createCredentialCreatedPayload({
                    challenge: selectedChallenge,
                    credential,
                    init,
                    input,
                    method: selected.method,
                    response,
                }));
                response = await baseFetch(paymentInput, transport.setCredential({
                    ...fetchInit,
                    headers: initialRequest.headers,
                }, credential, { challenge: selectedChallenge }));
                const paymentRequired = await transport.isPaymentRequired(response, transportRequest);
                if (!paymentRequired) {
                    await settleAttempt(prepared, {
                        response,
                        status: response.ok ? 'accepted' : 'rejected',
                    });
                    preparedCredential = undefined;
                }
                // Cloning an unobserved stream would tee and buffer it indefinitely.
                if (response.ok && hasEventObservers(events, 'payment.response'))
                    await events.emit('payment.response', createPaymentResponsePayload({
                        challenge: selectedChallenge,
                        credential,
                        init,
                        input,
                        method: selected.method,
                        response,
                    }));
                if (!paymentRequired) {
                    if (!response.ok)
                        return response;
                    return MethodResponse.handle(selected.method, {
                        challenge: selectedChallenge,
                        credential,
                        fetch: baseFetch,
                        headers: initialRequest.headers,
                        input: paymentInput,
                        ...(canRefetch
                            ? {
                                refetch: () => request(cloneRequestInput(initialRequest.input), init, false),
                            }
                            : {}),
                        response,
                        signal: resolveRequestSignal(input, init),
                    });
                }
            }
            challenges = undefined;
            try {
                challenges = await transport.getChallenges(response, transportRequest);
            }
            catch { }
            await settleAttempt(preparedCredential, {
                challenges,
                response,
                status: 'rejected',
            });
            return response;
        }
        catch (error) {
            await settleAttempt(preparedCredential, {
                challenges,
                response,
                status: 'rejected',
            });
            await events.emit('payment.failed', createPaymentFailedPayload({
                challenge,
                challenges,
                error,
                init,
                input,
                method: mi,
                response,
            }));
            throw error;
        }
    };
    const wrappedFetch = (input, init) => request(input, init, true);
    wrappedFetch[MPPX_FETCH_WRAPPER] = baseFetch;
    return wrappedFetch;
}
/**
 * Replaces the global `fetch` with a payment-aware wrapper.
 *
 * @example
 * ```ts
 * import { Fetch, tempo } from 'mppx/client'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * Fetch.polyfill({
 *   methods: [
 *     tempo({
 *       account: privateKeyToAccount('0x...'),
 *     }),
 *   ],
 * })
 *
 * // Global fetch now handles 402 automatically
 * const res = await fetch('https://api.example.com/resource')
 * ```
 */
export function polyfill(config) {
    // Defensive guard for runtimes/tests where fetch might be non-configurable.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    if (!descriptor || (!descriptor.writable && !descriptor.set)) {
        throw new Error('globalThis.fetch is not writable');
    }
    if (!originalFetch)
        originalFetch = globalThis.fetch;
    globalThis.fetch = from({
        ...config,
        acceptPaymentPolicy: config.acceptPaymentPolicy ?? (isBrowser() ? 'same-origin' : 'always'),
        fetch: globalThis.fetch,
    });
}
/**
 * Restores the original `fetch` after calling `polyfill`.
 *
 * @example
 * ```ts
 * import { Fetch } from 'mppx/client'
 *
 * Fetch.polyfill({ methods: [...] })
 *
 * // ... use payment-aware fetch ...
 *
 * Fetch.restore()
 * ```
 */
export function restore() {
    // Only restore if the current fetch is still an mppx wrapper.
    // If app code replaced fetch after polyfill(), we must not overwrite it.
    if (originalFetch && isWrappedFetch(globalThis.fetch)) {
        globalThis.fetch = originalFetch;
        originalFetch = undefined;
    }
}
/** @internal Normalizes headers to a plain object for spreading. */
export function normalizeHeaders(headers) {
    if (!headers)
        return {};
    if (headers instanceof Headers) {
        const result = {};
        headers.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }
    if (Array.isArray(headers))
        return Object.fromEntries(headers);
    return headers;
}
/**
 * Creates a typed client payment event dispatcher.
 *
 * `challenge.received` handlers run before `onChallenge`; the first non-empty
 * credential returned by a handler wins. Observation handlers are isolated, so
 * thrown listener errors do not stop sibling listeners or payment flow.
 */
export function createEventDispatcher() {
    const handlers = {
        '*': new Set(),
        'challenge.received': new Set(),
        'credential.created': new Set(),
        'payment.failed': new Set(),
        'payment.response': new Set(),
    };
    const on = (name, handler) => {
        switch (name) {
            case '*':
            case 'challenge.received':
            case 'credential.created':
            case 'payment.failed':
            case 'payment.response':
                handlers[name].add(handler);
                return () => handlers[name].delete(handler);
            default:
                throw new Error(`Unknown client event "${String(name)}".`);
        }
    };
    const dispatcher = {
        async emit(name, payload) {
            switch (name) {
                case 'challenge.received': {
                    let credential;
                    for (const handler of handlers['challenge.received']) {
                        const value = await emitChallengeReceived(handler, payload);
                        if (typeof value === 'string' && value.length > 0) {
                            credential = value;
                            break;
                        }
                    }
                    await emitCatchall(handlers['*'], name, payload);
                    return credential;
                }
                case 'credential.created':
                    await emitObserveHandlers(handlers['credential.created'], payload);
                    await emitCatchall(handlers['*'], name, payload);
                    return undefined;
                case 'payment.failed':
                    await emitObserveHandlers(handlers['payment.failed'], payload);
                    await emitCatchall(handlers['*'], name, payload);
                    return undefined;
                case 'payment.response':
                    await emitObserveHandlers(handlers['payment.response'], payload);
                    await emitCatchall(handlers['*'], name, payload);
                    return undefined;
            }
        },
        on,
    };
    eventObserverChecks.set(dispatcher, (name) => handlers[name].size > 0 || handlers['*'].size > 0);
    return dispatcher;
}
function hasEventObservers(dispatcher, name) {
    return eventObserverChecks.get(dispatcher)?.(name) ?? true;
}
async function emitChallengeReceived(handler, payload) {
    try {
        return await handler(payload);
    }
    catch {
        return undefined;
    }
}
async function emitObserveHandlers(handlers, payload) {
    for (const handler of handlers) {
        try {
            await handler(payload);
        }
        catch {
            // Client observation events must not alter payment flow.
        }
    }
}
async function emitCatchall(handlers, name, payload) {
    await emitObserveHandlers(handlers, Object.freeze({ name, payload }));
}
function memoizeCreateCredential(createCredential) {
    let promise;
    return (context) => {
        promise ??= createCredential(context);
        return promise;
    };
}
function createChallengeReceivedPayload(parameters) {
    return Object.freeze({
        challenge: snapshotValue(parameters.challenge),
        challenges: parameters.challenges.map((challenge) => snapshotValue(challenge)),
        createCredential: parameters.createCredential,
        init: snapshotInit(parameters.init),
        input: snapshotInput(parameters.input),
        method: snapshotMethod(parameters.method),
        response: snapshotResponse(parameters.response),
    });
}
function createCredentialCreatedPayload(parameters) {
    return Object.freeze({
        challenge: snapshotValue(parameters.challenge),
        credential: parameters.credential,
        init: snapshotInit(parameters.init),
        input: snapshotInput(parameters.input),
        method: snapshotMethod(parameters.method),
        ...(parameters.response !== undefined
            ? { response: snapshotResponse(parameters.response) }
            : {}),
    });
}
function createPaymentResponsePayload(parameters) {
    return Object.freeze({
        challenge: snapshotValue(parameters.challenge),
        credential: parameters.credential,
        init: snapshotInit(parameters.init),
        input: snapshotInput(parameters.input),
        method: snapshotMethod(parameters.method),
        response: snapshotResponse(parameters.response),
    });
}
function createPaymentFailedPayload(parameters) {
    return Object.freeze({
        ...(parameters.challenge ? { challenge: snapshotValue(parameters.challenge) } : {}),
        ...(parameters.challenges
            ? { challenges: parameters.challenges.map((challenge) => snapshotValue(challenge)) }
            : {}),
        error: parameters.error,
        init: snapshotInit(parameters.init),
        input: snapshotInput(parameters.input),
        ...(parameters.method ? { method: snapshotMethod(parameters.method) } : {}),
        ...(parameters.response !== undefined
            ? { response: snapshotResponse(parameters.response) }
            : {}),
    });
}
function snapshotInit(init) {
    if (!init)
        return undefined;
    return freezeSnapshot({
        ...init,
        ...(init.headers ? { headers: new Headers(init.headers) } : {}),
    });
}
function snapshotInput(input) {
    if (input instanceof Request) {
        try {
            return input.clone();
        }
        catch {
            return input;
        }
    }
    if (input instanceof URL)
        return new URL(input);
    return input;
}
function snapshotMethod(method) {
    return freezeSnapshot(Object.assign({}, method));
}
function snapshotResponse(response) {
    if (response instanceof Response)
        return response.clone();
    return snapshotValue(response);
}
function snapshotValue(value) {
    try {
        return deepFreeze(structuredClone(value));
    }
    catch {
        return freezeSnapshot(value);
    }
}
function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    Object.freeze(value);
    for (const child of Object.values(value))
        deepFreeze(child);
    return value;
}
function freezeSnapshot(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value))
        return value;
    Object.freeze(value);
    return value;
}
/** @internal */
function prepareInitialRequest(input, init, callerHeaders, header, hasExplicitAcceptPayment, policy) {
    const shouldInjectAcceptPayment = Boolean(header) && !hasExplicitAcceptPayment && shouldInjectForPolicy(input, policy);
    if (!shouldInjectAcceptPayment)
        return { headers: callerHeaders, init, input };
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    callerHeaders.forEach((value, key) => {
        headers.set(key, value);
    });
    headers.set(Constants.Headers.acceptPayment, header);
    if (init) {
        // Preserve init identity for callers like websocket upgrade helpers that
        // depend on the original RequestInit object reaching the underlying fetch.
        ;
        init.headers = headers;
        return {
            headers,
            init,
            input,
        };
    }
    return {
        headers,
        init: shouldInjectAcceptPayment ? { headers } : undefined,
        input,
    };
}
function captureRequestBody(input, init, headers) {
    if (!(input instanceof Request) || init?.body !== undefined || !input.body || input.bodyUsed)
        return undefined;
    if (!headers.has('mcp-method')) {
        const accept = headers.get('accept')?.toLowerCase() ?? '';
        if (!accept.includes('application/json') || !accept.includes('text/event-stream'))
            return undefined;
    }
    try {
        return input
            .clone()
            .text()
            .catch(() => undefined);
    }
    catch {
        return undefined;
    }
}
function withCapturedBody(init, body) {
    return body === undefined ? init : { ...init, body };
}
/** @internal */
function getCallerHeaders(input, headers) {
    if (headers)
        return new Headers(headers);
    return new Headers(input instanceof Request ? input.headers : undefined);
}
/** @internal */
/** @internal */
export function unwrapFetch(fetch) {
    let current = fetch;
    while (current[MPPX_FETCH_WRAPPER]) {
        current = current[MPPX_FETCH_WRAPPER];
    }
    return current;
}
function cloneRequestInput(input) {
    if (!(input instanceof Request) || !input.body || input.bodyUsed)
        return input;
    try {
        return input.clone();
    }
    catch {
        return input;
    }
}
function resolveRequestSignal(input, init) {
    return init?.signal ?? (input instanceof Request ? input.signal : undefined);
}
/** @internal */
function isWrappedFetch(fetch) {
    return Boolean(fetch[MPPX_FETCH_WRAPPER]);
}
/** @internal */
export function validateCredentialHeaderValue(credential) {
    if (!credential.trim())
        throw new Error('Credential header value must be non-empty');
    if (credential.includes('\r') || credential.includes('\n')) {
        throw new Error('Credential header value contains illegal newline characters');
    }
}
/** @internal */
async function resolveCredential(challenge, mi, context, attempt) {
    const parsedContext = mi.context && context !== undefined ? mi.context.parse(context) : undefined;
    const parameters = parsedContext !== undefined ? { challenge, context: parsedContext } : { challenge };
    if (attempt)
        MethodResponse.attachAttempt(mi, parameters, attempt);
    return mi.createCredential(parameters);
}
function resolvePaymentPreferences(headers, acceptPayment) {
    const header = headers.get(Constants.Headers.acceptPayment);
    if (!header)
        return acceptPayment;
    try {
        return {
            ...acceptPayment,
            entries: AcceptPayment.parse(header),
            header,
        };
    }
    catch {
        // Fail open for explicit malformed headers: preserve the caller's header on
        // the wire, but continue automatic challenge selection with configured
        // defaults instead of throwing from the wrapper.
        return acceptPayment;
    }
}
async function resolveChallengeOrder(candidates, orderChallenges) {
    return orderChallenges ? orderChallenges(candidates) : candidates;
}
/** @internal */
/** @internal */
export function shouldInjectForPolicy(input, policy) {
    if (policy === 'always')
        return true;
    if (policy === 'never')
        return false;
    const url = resolveRequestUrl(input);
    if (policy === 'same-origin') {
        if (!isBrowser())
            return true;
        return url.origin === globalThis.location.origin;
    }
    return policy.origins.some((origin) => matchesOrigin(url, origin));
}
/** @internal Matches an origin pattern, supporting `*.` prefix for subdomain wildcards. */
function matchesOrigin(url, pattern) {
    if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1); // e.g. ".example.com"
        return url.hostname.endsWith(suffix) || url.hostname === pattern.slice(2);
    }
    return url.origin === new URL(pattern).origin;
}
/** @internal */
function isBrowser() {
    return typeof globalThis.location !== 'undefined';
}
/** @internal */
function resolveRequestUrl(input) {
    if (input instanceof URL)
        return input;
    if (input instanceof Request)
        return new URL(input.url);
    return new URL(input, isBrowser() ? globalThis.location.href : undefined);
}
function resolvePaymentRetryInput(response, fallback, initialInput) {
    if (!response.url)
        return fallback;
    const responseUrl = new URL(response.url);
    const initialUrl = resolveRequestUrl(initialInput);
    if (responseUrl.origin !== initialUrl.origin) {
        throw new Error(`Refusing to send payment credential across redirect from ${initialUrl.origin} to ${responseUrl.origin}`);
    }
    return response.url;
}
//# sourceMappingURL=Fetch.js.map