import * as AttestationClient from '../attestation/Client.js';
import * as Constants from '../Constants.js';
import * as Expires from '../Expires.js';
import * as AcceptPayment from '../internal/AcceptPayment.js';
import * as Fetch from './internal/Fetch.js';
import * as MethodChallenge from './internal/MethodChallenge.js';
import * as Transport from './Transport.js';
const preparedPaymentMethods = new WeakMap();
/**
 * Creates a client-side payment handler from an array of methods.
 *
 * Returns a payment handler with a `fetch` function that automatically handles
 * 402 Payment Required responses. By default, also polyfills `globalThis.fetch`.
 *
 * @example
 * ```ts
 * import { Mppx, tempo } from 'mppx/client'
 *
 * const mppx = Mppx.create({
 *   methods: [tempo({ account })],
 * })
 *
 * // Use the returned fetch — handles 402 automatically
 * const res = await mppx.fetch('/resource')
 *
 * // Or use globalThis.fetch (polyfilled by default)
 * const res2 = await fetch('/resource')
 * ```
 */
export function create(config) {
    const { attestation, maxPaymentRetries, onChallenge, orderChallenges, polyfill = true, acceptPaymentPolicy = polyfill && typeof globalThis.location !== 'undefined'
        ? 'same-origin'
        : 'always', transport = Transport.http(), } = config;
    const rawFetch = Fetch.unwrapFetch(config.fetch ?? globalThis.fetch);
    const attestationSigner = attestation
        ? createAttestationSigner(attestation)
        : undefined;
    const attestedFetch = attestationSigner
        ? AttestationClient.wrapFetch(rawFetch, attestationSigner)
        : rawFetch;
    const methods = config.methods.flat();
    const acceptPayment = AcceptPayment.resolve(methods, config.paymentPreferences);
    const events = Fetch.createEventDispatcher();
    const resolvedOnChallenge = onChallenge;
    const config_fetch = {
        acceptPayment,
        acceptPaymentPolicy,
        ...((config.fetch || attestation) && { fetch: attestedFetch }),
        eventDispatcher: events,
        ...(maxPaymentRetries !== undefined && { maxPaymentRetries }),
        ...(resolvedOnChallenge && { onChallenge: resolvedOnChallenge }),
        ...(orderChallenges && { orderChallenges }),
        methods,
        transport,
    };
    const fetch = Fetch.from(config_fetch);
    if (polyfill)
        Fetch.polyfill(config_fetch);
    function onChallengeReceived(handler) {
        return events.on('challenge.received', handler);
    }
    function onCredentialCreated(handler) {
        return events.on('credential.created', handler);
    }
    function onPaymentFailed(handler) {
        return events.on('payment.failed', handler);
    }
    function onPaymentResponse(handler) {
        return events.on('payment.response', handler);
    }
    async function preparePayment(response, options) {
        const eventResponse = snapshotResponse(response);
        const challenges = await transport.getChallenges(response, options?.request);
        const challengeSnapshots = Object.freeze(challenges.map((candidate) => snapshotValue(candidate)));
        const preferences = resolveChallengePreferences(acceptPayment.entries, options?.acceptPayment);
        let challenge;
        let mi;
        try {
            const candidates = AcceptPayment.selectChallengeCandidates(challenges, methods, preferences);
            const orderedCandidates = await resolveChallengeOrder(candidates, options?.orderChallenges ?? orderChallenges);
            const selected = orderedCandidates[0];
            if (!selected)
                throw new Error(`No method found for challenges: ${challenges.map((challenge) => `${challenge.method}.${challenge.intent}`).join(', ')}. Available: ${methods.map((m) => `${m.name}.${m.intent}`).join(', ')}`);
            // Signing must use what the caller inspects, while attachment needs the adapter's original
            // object identity to retain protocol provenance.
            const transportChallenge = selected.challenge;
            challenge = challengeSnapshots[selected.index];
            mi = selected.method;
            if (challenge.expires)
                Expires.assert(challenge.expires, challenge.id);
            const selectedChallenge = challenge;
            const selectedMethod = mi;
            const createPreparedCredential = memoizeCreateCredential(async (context) => {
                try {
                    if (selectedChallenge.expires)
                        Expires.assert(selectedChallenge.expires, selectedChallenge.id);
                    const createCredential = memoizeCreateCredential((overrideContext) => createCredentialForMethod(selectedChallenge, selectedMethod, overrideContext ?? context));
                    const eventCredential = await events.emit('challenge.received', createChallengeReceivedPayload({
                        challenge: selectedChallenge,
                        challenges,
                        createCredential,
                        method: selectedMethod,
                        response: eventResponse,
                    }));
                    const credential = eventCredential ?? (await createCredential());
                    Fetch.validateCredentialHeaderValue(credential);
                    await events.emit('credential.created', createCredentialCreatedPayload({
                        challenge: selectedChallenge,
                        credential,
                        method: selectedMethod,
                        response: eventResponse,
                    }));
                    return credential;
                }
                catch (error) {
                    await events.emit('payment.failed', createPaymentFailedPayload({
                        challenge: selectedChallenge,
                        challenges,
                        error,
                        method: selectedMethod,
                        response: eventResponse,
                    }));
                    throw error;
                }
            });
            const prepared = Object.freeze({
                challenge: selectedChallenge,
                challenges: challengeSnapshots,
                createCredential: createPreparedCredential,
                method: snapshotMethod(selectedMethod),
                setCredential(request, credential) {
                    Fetch.validateCredentialHeaderValue(credential);
                    return transport.setCredential(request, credential, { challenge: transportChallenge });
                },
            });
            preparedPaymentMethods.set(prepared, selectedMethod);
            return prepared;
        }
        catch (error) {
            await events.emit('payment.failed', createPaymentFailedPayload({
                challenge,
                challenges,
                error,
                method: mi,
                response: eventResponse,
            }));
            throw error;
        }
    }
    async function prepareRequest(input, init, options) {
        const { maxRedirects = 20, requirePayment = false, ...paymentOptions } = options ?? {};
        const preparedHttp = await prepareHttpRequest({
            acceptPayment: acceptPayment.header,
            acceptPaymentPolicy,
            fetch: rawFetch,
            init,
            input,
            maxRedirects,
            signer: attestationSigner,
        });
        const requestInit = requestToInit(preparedHttp.replayRequest, preparedHttp.body);
        if (!(await transport.isPaymentRequired(preparedHttp.response, requestInit))) {
            if (requirePayment)
                throw new Error('Response does not require payment.');
            return Object.freeze({
                payment: undefined,
                request: preparedHttp.request,
                response: preparedHttp.response,
                redirects: preparedHttp.redirects,
            });
        }
        const payment = (await preparePayment(preparedHttp.response, {
            ...paymentOptions,
            request: requestInit,
        }));
        const paymentMethod = preparedPaymentMethods.get(payment) ?? payment.method;
        const createRequestCredential = memoizeCreateCredential(async (context) => {
            if (MethodChallenge.has(paymentMethod))
                await MethodChallenge.handle(paymentMethod, {
                    challenge: payment.challenge,
                    context,
                    fetch: attestedFetch,
                    input: preparedHttp.replayRequest,
                });
            return payment.createCredential(context);
        });
        const preparedPayment = Object.freeze({
            ...payment,
            createCredential: createRequestCredential,
            async pay(context) {
                const credential = await createRequestCredential(context);
                const paidInit = payment.setCredential(requestToInit(preparedHttp.replayRequest, preparedHttp.body), credential);
                return attestedFetch(preparedHttp.replayRequest.url, {
                    ...paidInit,
                    redirect: 'manual',
                });
            },
        });
        return Object.freeze({
            payment: preparedPayment,
            request: preparedHttp.request,
            response: preparedHttp.response,
            redirects: preparedHttp.redirects,
        });
    }
    return {
        fetch,
        rawFetch,
        methods,
        transport,
        on: events.on,
        onChallengeReceived,
        onCredentialCreated,
        onPaymentFailed,
        onPaymentResponse,
        preparePayment,
        prepareRequest: prepareRequest,
        async createCredential(response, context, options) {
            const prepared = await preparePayment(response, options);
            return prepared.createCredential(context);
        },
    };
}
/**
 * Restores the original `fetch` after `create()` polyfilled it.
 *
 * @example
 * ```ts
 * import { Mppx, tempo } from 'mppx/client'
 *
 * Mppx.create({ methods: [tempo({ account })] })
 *
 * // ... use payment-aware fetch ...
 *
 * Mppx.restore()
 * ```
 */
export function restore() {
    Fetch.restore();
}
function createAttestationSigner(signers) {
    const values = Object.values(signers);
    if (values.length === 0)
        throw new TypeError('Mppx client attestation must configure at least one signer.');
    return AttestationClient.composeSigners(...values);
}
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const bodyHeaders = [
    'content-encoding',
    'content-language',
    'content-length',
    'content-location',
    'content-type',
    'transfer-encoding',
];
const crossOriginHeaders = [
    'authorization',
    'cookie',
    'cookie2',
    'host',
    'payment-authorization',
    'payment-signature',
    'proxy-authorization',
    'x-payment',
];
async function prepareHttpRequest(parameters) {
    const { acceptPayment, acceptPaymentPolicy, fetch, init, input, maxRedirects, signer } = parameters;
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0)
        throw new TypeError('maxRedirects must be a non-negative integer.');
    let request = new Request(input, { ...init, redirect: 'manual' });
    const explicitAcceptPayment = request.headers.has(Constants.Headers.acceptPayment);
    let body = await replayBody(request, init?.body);
    const redirects = [];
    for (;;) {
        request = withAcceptPayment(request, acceptPayment, explicitAcceptPayment, acceptPaymentPolicy);
        const sentRequest = signer ? await signer.sign(request.clone()) : request.clone();
        const response = await fetch(sentRequest);
        if (response.type === 'opaqueredirect' || response.status === 0)
            throw new Error('prepareRequest requires a runtime that exposes manual redirect responses.');
        if (!redirectStatuses.has(response.status))
            return {
                body,
                replayRequest: request,
                request: sentRequest,
                response,
                redirects: Object.freeze(redirects),
            };
        const location = response.headers.get('location');
        if (!location)
            return {
                body,
                replayRequest: request,
                request: sentRequest,
                response,
                redirects: Object.freeze(redirects),
            };
        if (redirects.length >= maxRedirects) {
            await response.body?.cancel();
            throw new Error(`Payment request exceeded ${maxRedirects} redirects.`);
        }
        const from = new URL(request.url);
        const to = new URL(location, from);
        if (from.protocol === 'https:' && to.protocol !== 'https:') {
            await response.body?.cancel();
            throw new Error(`Payment request refused HTTPS downgrade redirect to ${to.href}`);
        }
        const headers = new Headers(request.headers);
        let method = request.method;
        const switchesToGet = ((response.status === 301 || response.status === 302) && method === 'POST') ||
            (response.status === 303 && method !== 'GET' && method !== 'HEAD');
        if (switchesToGet) {
            method = 'GET';
            body = undefined;
            for (const header of bodyHeaders)
                headers.delete(header);
        }
        if (from.origin !== to.origin)
            for (const header of [...headers.keys()]) {
                const value = headers.get(header) ?? '';
                if (crossOriginHeaders.includes(header) || value.startsWith('Payment '))
                    headers.delete(header);
            }
        redirects.push(Object.freeze({ from: from.href, status: response.status, to: to.href }));
        await response.body?.cancel();
        request = new Request(to, requestInit(request, headers, method, body));
    }
}
function requestToInit(request, body) {
    return requestInit(request, new Headers(request.headers), request.method, body);
}
async function replayBody(request, suppliedBody) {
    if (typeof suppliedBody === 'string')
        return suppliedBody;
    if (!request.body)
        return undefined;
    const accept = request.headers.get('accept')?.toLowerCase() ?? '';
    if (request.headers.has('mcp-method') ||
        (accept.includes('application/json') && accept.includes('text/event-stream')))
        return request.clone().text();
    return request.clone().arrayBuffer();
}
function withAcceptPayment(request, acceptPayment, explicit, policy) {
    if (explicit)
        return request;
    const headers = new Headers(request.headers);
    headers.delete(Constants.Headers.acceptPayment);
    if (acceptPayment && Fetch.shouldInjectForPolicy(request, policy))
        headers.set(Constants.Headers.acceptPayment, acceptPayment);
    return new Request(request, { headers });
}
function requestInit(request, headers, method, body) {
    return {
        ...(body ? { body } : {}),
        cache: request.cache,
        credentials: request.credentials,
        headers,
        integrity: request.integrity,
        keepalive: request.keepalive,
        method,
        mode: request.mode,
        redirect: 'manual',
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        signal: request.signal,
    };
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
        method: snapshotMethod(parameters.method),
        response: snapshotResponse(parameters.response),
    });
}
function createCredentialCreatedPayload(parameters) {
    return Object.freeze({
        challenge: snapshotValue(parameters.challenge),
        credential: parameters.credential,
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
        ...(parameters.method ? { method: snapshotMethod(parameters.method) } : {}),
        response: snapshotResponse(parameters.response),
    });
}
function snapshotMethod(method) {
    return freezeSnapshot(Object.assign({}, method));
}
function snapshotResponse(response) {
    if (response instanceof Response) {
        try {
            return response.clone();
        }
        catch {
            // A consumed body cannot be cloned, but status and headers are sufficient for event context.
            return new Response(null, {
                headers: response.headers,
                status: response.status,
                statusText: response.statusText,
            });
        }
    }
    return snapshotValue(response);
}
function snapshotValue(value) {
    try {
        const snapshot = structuredClone(value);
        // Protocol adapters may attach non-enumerable symbol metadata to otherwise plain challenges.
        if (value && snapshot && typeof value === 'object' && typeof snapshot === 'object')
            for (const symbol of Object.getOwnPropertySymbols(value)) {
                const descriptor = Object.getOwnPropertyDescriptor(value, symbol);
                if (descriptor)
                    Object.defineProperty(snapshot, symbol, descriptor);
            }
        return deepFreeze(snapshot);
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
function resolveChallengePreferences(fallback, override) {
    if (!override)
        return fallback;
    return typeof override === 'string' ? AcceptPayment.parse(override) : override;
}
async function resolveChallengeOrder(candidates, orderChallenges) {
    return orderChallenges ? orderChallenges(candidates) : candidates;
}
async function createCredentialForMethod(challenge, mi, context) {
    const parsedContext = mi.context && context !== undefined ? mi.context.parse(context) : undefined;
    return mi.createCredential(parsedContext !== undefined ? { challenge, context: parsedContext } : { challenge });
}
//# sourceMappingURL=Mppx.js.map