import { Hex } from 'ox';
import * as Challenge from '../../../Challenge.js';
import * as Fetch from '../../../client/internal/Fetch.js';
import * as Constants from '../../../Constants.js';
import * as PaymentCredential from '../../../Credential.js';
import { deserializeSessionReceipt, isEventStream, parseEvent, readSessionChallengeAmount, uint96, } from '../precompile/Protocol.js';
import * as Ws from '../precompile/Protocol.js';
import { activeStateFromChannel, activeStateFromReceipt, isExpectedCloseReceipt, parseManagerAmount, } from './Runtime.js';
/** Numeric ready-state constants used by browser-compatible WebSocket clients. */
export const WebSocketReadyState = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
};
// Browser-style WebSocket clients may only initiate close with 1000 or 3000-4999.
// Keep protocol/policy close codes on the server side and use an app-defined code here.
/** Client-side close code used for payment protocol errors. */
export const ClientWebSocketProtocolErrorCloseCode = 3008;
const webSocketChallengeRefreshWindowMs = 5_000;
/** Wraps a raw WebSocket so protocol frames can be handled before user listeners see messages. */
export function createManagedSocket(socket) {
    const listeners = new Map();
    let emittedClose = false;
    let messageBuffer = [];
    let readyState = socket.readyState;
    const add = (type, listener, options) => {
        let set = listeners.get(type);
        if (!set) {
            set = new Set();
            listeners.set(type, set);
        }
        set.add({
            once: typeof options === 'object' ? options.once === true : false,
            value: listener,
        });
        if (type === 'message' && messageBuffer) {
            const buffered = messageBuffer;
            messageBuffer = null;
            for (const event of buffered)
                emit('message', event);
        }
    };
    const remove = (type, listener) => {
        const set = listeners.get(type);
        if (!set)
            return;
        for (const entry of set) {
            if (entry.value === listener)
                set.delete(entry);
        }
    };
    function emit(type, event) {
        if (event.type === 'close') {
            if (emittedClose)
                return;
            emittedClose = true;
            readyState = WebSocketReadyState.CLOSED;
            messageBuffer = null;
        }
        if (event.type === 'open')
            readyState = WebSocketReadyState.OPEN;
        if (event.type === 'message' && messageBuffer) {
            messageBuffer.push(event);
            return;
        }
        switch (event.type) {
            case 'close':
                managed.onclose?.(event);
                break;
            case 'error':
                managed.onerror?.(event);
                break;
            case 'message':
                managed.onmessage?.(event);
                break;
            case 'open':
                managed.onopen?.(event);
                break;
        }
        const set = listeners.get(type);
        if (!set)
            return;
        for (const entry of Array.from(set)) {
            if (typeof entry.value === 'function')
                entry.value(event);
            else
                entry.value.handleEvent(event);
            if (entry.once)
                set.delete(entry);
        }
    }
    let onmessage = null;
    const managed = {
        addEventListener: add,
        close(code, reason) {
            socket.close(code, reason);
        },
        get bufferedAmount() {
            return socket.bufferedAmount;
        },
        get extensions() {
            return socket.extensions;
        },
        on(type, listener) {
            add(type, listener);
        },
        onclose: null,
        onerror: null,
        get onmessage() {
            return onmessage;
        },
        set onmessage(fn) {
            onmessage = fn;
            if (fn && messageBuffer) {
                const buffered = messageBuffer;
                messageBuffer = null;
                for (const event of buffered)
                    emit('message', event);
            }
        },
        onopen: null,
        off(type, listener) {
            remove(type, listener);
        },
        get protocol() {
            return socket.protocol;
        },
        get readyState() {
            return readyState;
        },
        removeEventListener: remove,
        send(data) {
            socket.send(data);
        },
        get url() {
            return socket.url;
        },
    };
    return {
        emit,
        socket: managed,
    };
}
/** Parses raw-unit numeric fields from a need-voucher event. */
export function readNeedVoucherEventAmounts(event) {
    return {
        acceptedCumulative: BigInt(event.acceptedCumulative),
        deposit: BigInt(event.deposit),
        requiredCumulative: BigInt(event.requiredCumulative),
    };
}
/** Validates local manager state and returns the concrete top-up operation to execute. */
export function resolveManualTopUp(parameters) {
    const { amount, assertVoucherWithinLocalLimit, channel, decimals, lastChallenge, lastUrl } = parameters;
    if (!channel?.opened)
        throw new Error('Cannot top up session: no open channel.');
    if (!lastChallenge) {
        throw new Error('Cannot top up session: no challenge available. Make a request first.');
    }
    if (!lastUrl) {
        throw new Error('Cannot top up session: no URL available. Call fetch(), sse(), or ws() first.');
    }
    const additionalDeposit = parseManagerAmount(amount, decimals);
    if (additionalDeposit <= 0n)
        throw new Error('Top-up amount must be greater than zero.');
    assertVoucherWithinLocalLimit(channel.cumulativeAmount + additionalDeposit);
    return {
        additionalDeposit,
        challenge: lastChallenge,
        channelId: channel.channelId,
        input: lastUrl,
    };
}
/**
 * Applies local deposit and state bookkeeping for a top-up response.
 *
 * Deposit advances from the highest known baseline. Receipt cumulative values
 * only update accepted spend authorization; they do not replace deposit.
 */
export function applyTopUpResult(parameters) {
    const { additionalDeposit, channel, channelId, challengeId, currentState, knownDeposit, receipt, spent, } = parameters;
    if (channel?.channelId !== channelId)
        return undefined;
    const baseline = knownDeposit !== undefined && knownDeposit > channel.deposit ? knownDeposit : channel.deposit;
    const updated = { ...channel, deposit: baseline + additionalDeposit };
    if (receipt)
        return { channel: updated, state: activeStateFromReceipt(receipt, updated) };
    if (!challengeId)
        return { channel: updated };
    return {
        channel: updated,
        state: activeStateFromChannel({
            challengeId,
            entry: updated,
            spent: spent.toString(),
            units: currentState.status === 'active' ? currentState.units : 0,
        }),
    };
}
/**
 * Applies local top-up/cumulative bookkeeping for a need-voucher event and
 * returns an explicit transport decision.
 */
export async function resolveNeedVoucherContext(parameters) {
    if (parameters.event.channelId !== parameters.expectedChannelId) {
        return { status: 'ignored', reason: 'channel-mismatch' };
    }
    const eventAmounts = readNeedVoucherEventAmounts(parameters.event);
    parameters.assertVoucherWithinLocalLimit(eventAmounts.requiredCumulative);
    await parameters.topUpIfNeeded({
        challenge: parameters.challenge,
        input: parameters.input,
        channelId: parameters.expectedChannelId,
        deposit: eventAmounts.deposit,
        requiredCumulative: eventAmounts.requiredCumulative,
    });
    const channel = parameters.getChannel();
    if (!channel || channel.channelId !== parameters.expectedChannelId) {
        return { status: 'ignored', reason: 'missing-channel' };
    }
    const cumulativeAmount = channel.cumulativeAmount > eventAmounts.requiredCumulative
        ? channel.cumulativeAmount
        : uint96(eventAmounts.requiredCumulative);
    return {
        status: 'ready',
        context: {
            action: 'voucher',
            channelId: parameters.expectedChannelId,
            descriptor: channel.descriptor,
            cumulativeAmountRaw: cumulativeAmount.toString(),
        },
    };
}
/** Returns true when a payment challenge is the built-in `tempo/session` method. */
export function isTempoSessionChallenge(challenge) {
    return (challenge.method === Constants.Methods.tempo && challenge.intent === Constants.Intents.session);
}
/** Returns true when a challenge selects the TIP-1034 session protocol. */
export function isTip1034SessionChallenge(challenge) {
    return (isTempoSessionChallenge(challenge) &&
        Constants.getMethodDetail(challenge.request.methodDetails, Constants.MethodDetailKeys.sessionProtocol) === Constants.SessionProtocols.v2);
}
/** Reads a server-provided session snapshot from challenge method details. */
export function getSessionSnapshot(challenge) {
    return Constants.getMethodDetail(challenge.request.methodDetails, Constants.MethodDetailKeys.sessionSnapshot);
}
/** Merges request headers and sets the payment authorization header for a retry. */
export function requestInitWithAuthorization(input, init, credential) {
    const requestHeaders = input instanceof Request ? input.headers : undefined;
    return {
        ...init,
        headers: {
            ...Fetch.normalizeHeaders(requestHeaders),
            ...Fetch.normalizeHeaders(init?.headers),
            [Constants.Headers.authorization]: credential,
        },
    };
}
/** Returns the exact resource URL used for out-of-band management POSTs, without its fragment. */
export function managementInput(input) {
    try {
        const base = typeof location === 'undefined' ? undefined : location.href;
        const url = input instanceof Request
            ? new URL(input.url)
            : input instanceof URL
                ? new URL(input)
                : new URL(String(input), base);
        url.hash = '';
        return url;
    }
    catch {
        return input;
    }
}
/** Converts a WebSocket URL into the HTTP URL used for its payment challenge probe. */
export function webSocketProbeUrl(input) {
    const url = new URL(input.toString());
    if (url.protocol === 'ws:')
        url.protocol = 'http:';
    if (url.protocol === 'wss:')
        url.protocol = 'https:';
    return url;
}
/** Reads an HTTP problem detail body, falling back to raw text for non-problem responses. */
export async function readProblemDetail(response) {
    const body = await response.text().catch(() => '');
    if (!body)
        return '';
    if (!response.headers.get('Content-Type')?.includes('application/problem+json'))
        return body;
    try {
        const problem = JSON.parse(body);
        return problem.detail ?? body;
    }
    catch {
        return body;
    }
}
/** Posts a top-up management credential and returns its receipt, when present. */
export async function postTopUp(parameters) {
    const { channel, channelId } = parameters;
    if (!channel?.descriptor || channel.channelId !== channelId) {
        throw new Error('Cannot top up session: no local channel descriptor available.');
    }
    const response = await postManagementCredential({
        challenge: parameters.challenge,
        context: {
            action: 'topUp',
            channelId,
            descriptor: channel.descriptor,
            additionalDepositRaw: parameters.additionalDeposit.toString(),
        },
        createSessionCredential: parameters.createSessionCredential,
        fetch: parameters.fetch,
        input: parameters.input,
    });
    if (!response.ok)
        throw new Error(`Top-up POST failed with status ${response.status}`);
    const receiptHeader = response.headers.get(Constants.Headers.paymentReceipt);
    return receiptHeader ? deserializeSessionReceipt(receiptHeader) : undefined;
}
/** Posts a management credential and retries once with a refreshed TIP-1034 challenge. */
async function postManagementCredential(parameters) {
    const post = async (challenge) => parameters.fetch(managementInput(parameters.input), {
        method: 'POST',
        headers: {
            [Constants.Headers.authorization]: await parameters.createSessionCredential(challenge, parameters.context),
        },
    });
    const response = await post(parameters.challenge);
    if (response.status !== 402)
        return response;
    const challenge = Challenge.fromResponseList(response).find(isTip1034SessionChallenge);
    return challenge ? post(challenge) : response;
}
/** Retries an HTTP 402 when the server snapshot asks for more voucher headroom. */
export async function retryHttpPaymentRequired(parameters) {
    const context = resolveRetryHttpPaymentContext({
        channel: parameters.getChannel(),
        response: parameters.response,
    });
    if (!context)
        return undefined;
    const { channel, challenge, snapshot } = context;
    parameters.setChallenge(challenge);
    const requiredCumulative = BigInt(snapshot.requiredCumulative);
    const cumulativeBeforeVoucher = channel.cumulativeAmount;
    await parameters.topUpIfNeeded({
        challenge,
        input: parameters.input,
        channelId: snapshot.channelId,
        deposit: BigInt(snapshot.deposit),
        requiredCumulative,
    });
    const currentChannel = parameters.getChannel();
    if (!currentChannel?.descriptor || currentChannel.channelId !== snapshot.channelId) {
        return undefined;
    }
    const cumulativeAmount = currentChannel.cumulativeAmount > requiredCumulative
        ? currentChannel.cumulativeAmount
        : requiredCumulative;
    const restore = () => parameters.restoreCumulative(snapshot.channelId, cumulativeBeforeVoucher);
    let retry;
    try {
        const credential = await parameters.createSessionCredential(challenge, {
            action: 'voucher',
            channelId: snapshot.channelId,
            descriptor: currentChannel.descriptor,
            cumulativeAmountRaw: cumulativeAmount.toString(),
        });
        retry = await parameters.fetch(parameters.input, requestInitWithAuthorization(parameters.input, parameters.init, credential));
    }
    catch (error) {
        await restore();
        throw error;
    }
    if (!retry.ok && !retry.headers.get(Constants.Headers.paymentReceipt)) {
        await restore();
    }
    return retry;
}
/** Resolves whether a 402 response can be handled by an automatic session voucher retry. */
export function resolveRetryHttpPaymentContext(parameters) {
    const challenge = Challenge.fromResponseList(parameters.response).find(isTip1034SessionChallenge);
    if (!challenge)
        return undefined;
    const snapshot = getSessionSnapshot(challenge);
    if (!snapshot)
        return undefined;
    const { channel } = parameters;
    if (!channel?.descriptor || channel.channelId !== snapshot.channelId)
        return undefined;
    return { channel, challenge, snapshot };
}
/** Posts a cooperative close credential over HTTP and returns its receipt, when present. */
export async function closeHttpSession(parameters) {
    if (!parameters.lastUrl) {
        throw new Error('Cannot close session: no URL available. This usually means close() was called on a SessionManager instance that was recreated after the session was opened. Use the same SessionManager instance that opened the session, or call fetch()/sse() before close().');
    }
    let closeChallenge = parameters.target.challenge;
    let signedCloseAmount = parameters.signedCloseAmount;
    const postClose = async (challenge, refreshed = false) => {
        closeChallenge = challenge;
        signedCloseAmount =
            (refreshed ? parameters.resolveSignedCloseAmount?.(challenge) : undefined) ??
                parameters.signedCloseAmount;
        const credential = await parameters.createSessionCredential(challenge, {
            action: 'close',
            channelId: parameters.target.channelId,
            descriptor: parameters.target.channel.descriptor,
            cumulativeAmountRaw: signedCloseAmount,
        });
        return parameters.fetch(parameters.lastUrl, {
            method: 'POST',
            headers: { [Constants.Headers.authorization]: credential },
        });
    };
    let response = await postClose(parameters.target.challenge);
    if (response.status === 402) {
        const challenge = Challenge.fromResponseList(response).find(isTip1034SessionChallenge);
        if (challenge) {
            parameters.setChallenge?.(challenge);
            response = await postClose(challenge, true);
        }
    }
    if (!response.ok) {
        const detail = await readProblemDetail(response);
        const wwwAuth = response.headers.get(Constants.Headers.wwwAuthenticate) ?? '';
        throw new Error(`Close request failed with status ${response.status}${detail ? `: ${detail}` : ''}${wwwAuth ? ` [${Constants.Headers.wwwAuthenticate}: ${wwwAuth}]` : ''}`);
    }
    const receiptHeader = response.headers.get(Constants.Headers.paymentReceipt);
    if (!receiptHeader)
        return undefined;
    const receipt = deserializeSessionReceipt(receiptHeader);
    if (!receipt.txHash ||
        !Hex.validate(receipt.txHash, { strict: true }) ||
        Hex.size(receipt.txHash) !== 32 ||
        !isExpectedCloseReceipt({
            challengeId: closeChallenge.id,
            channelId: parameters.target.channelId,
            expectedCloseAmount: signedCloseAmount,
            minimumSpent: parameters.getMinimumSpent?.() ?? 0n,
            receipt,
        }))
        throw new Error('Session close response included a mismatched payment receipt.');
    return receipt;
}
/**
 * Opens an auto-driving paid SSE stream.
 *
 * The driver owns only transport parsing and management posts. Session state,
 * credential creation, and top-up policy stay in `SessionManager`.
 */
export async function openSseSession(input, init, driver) {
    const { onReceipt, signal, ...fetchInit } = init ?? {};
    const sseInit = {
        ...fetchInit,
        headers: {
            ...Fetch.normalizeHeaders(fetchInit.headers),
            Accept: 'text/event-stream',
        },
        ...(signal ? { signal } : {}),
    };
    let response = await driver.doFetch(input, sseInit);
    if (!isEventStream(response) && driver.getChannel()?.opened)
        response = await driver.doFetch(input, sseInit);
    return consumeSseSessionResponse(input, response, { onReceipt, signal }, driver);
}
/** @internal Consumes an already-paid SSE response with the session transport driver. */
export function consumeSseSessionResponse(input, response, options, driver) {
    if (!isEventStream(response))
        throw new Error('SSE response is not an event stream.');
    if (!response.body)
        throw new Error('Response has no body.');
    const challenge = driver.getChallenge();
    return iterateSseMessages({
        onNeedVoucher: (event) => handleSseNeedVoucher({ challenge, driver, input }, event),
        onReceipt(receipt) {
            driver.acceptReceipt(receipt);
            options?.onReceipt?.(receipt);
        },
        response,
        signal: options?.signal,
    });
}
async function* iterateSseMessages(parameters) {
    for await (const frame of driveSseResponse(parameters)) {
        if (frame.data !== undefined)
            yield frame.data;
    }
}
/** Handles session payment events and yields application SSE frames unchanged. */
export async function* driveSseResponse(parameters) {
    if (!parameters.response.body)
        throw new Error('Response has no body.');
    const reader = parameters.response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let complete = false;
    const cancel = () => {
        void reader.cancel(parameters.signal?.reason).catch(() => undefined);
    };
    parameters.signal?.addEventListener('abort', cancel, { once: true });
    if (parameters.signal?.aborted)
        cancel();
    try {
        while (true) {
            if (parameters.signal?.aborted)
                break;
            const { done, value } = await reader.read();
            if (done) {
                complete = true;
                buffer += decoder.decode();
            }
            else
                buffer += decoder.decode(value, { stream: true });
            while (true) {
                const separator = findSseSeparator(buffer, done);
                if (!separator)
                    break;
                const end = separator.index + separator.length;
                const part = buffer.slice(0, separator.index);
                const raw = buffer.slice(0, end);
                buffer = buffer.slice(end);
                if (!part.trim())
                    continue;
                const event = parseEvent(part.replace(/\r\n|\r/g, '\n'));
                if (!event) {
                    yield { raw };
                    continue;
                }
                switch (event.type) {
                    case 'message':
                        yield { data: event.data, raw };
                        break;
                    case 'payment-need-voucher':
                        await parameters.onNeedVoucher(event.data);
                        break;
                    case 'payment-receipt':
                        parameters.onReceipt(event.data);
                        break;
                }
            }
            if (done)
                break;
        }
    }
    finally {
        parameters.signal?.removeEventListener('abort', cancel);
        if (!complete)
            await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
function findSseSeparator(value, complete) {
    for (let index = 0; index < value.length; index++) {
        const first = lineEndingLength(value, index, complete);
        if (!first)
            continue;
        const second = lineEndingLength(value, index + first, complete);
        if (second)
            return { index, length: first + second };
        index += first - 1;
    }
    return undefined;
}
function lineEndingLength(value, index, complete) {
    if (value[index] === '\n')
        return 1;
    if (value[index] !== '\r')
        return 0;
    if (value[index + 1] === '\n')
        return 2;
    if (index + 1 === value.length && !complete)
        return 0;
    return 1;
}
/** Wraps an SSE response while handling session payment frames in-band. */
export function wrapSseResponse(parameters) {
    const abortController = new AbortController();
    const abort = () => abortController.abort(parameters.signal?.reason);
    parameters.signal?.addEventListener('abort', abort, { once: true });
    if (parameters.signal?.aborted)
        abort();
    const iterator = driveSseResponse({ ...parameters, signal: abortController.signal });
    const encoder = new TextEncoder();
    const headers = new Headers(parameters.response.headers);
    headers.delete('content-length');
    const cleanup = () => parameters.signal?.removeEventListener('abort', abort);
    const response = new Response(new ReadableStream({
        async pull(controller) {
            try {
                const frame = await iterator.next();
                if (frame.done) {
                    cleanup();
                    return controller.close();
                }
                controller.enqueue(encoder.encode(frame.value.raw));
            }
            catch (error) {
                cleanup();
                throw error;
            }
        },
        async cancel() {
            cleanup();
            abortController.abort();
            await iterator.return(undefined);
        },
    }), {
        headers,
        status: parameters.response.status,
        statusText: parameters.response.statusText,
    });
    for (const property of ['redirected', 'type', 'url'])
        Object.defineProperty(response, property, {
            configurable: true,
            get: () => parameters.response[property],
        });
    return response;
}
/** Handles an in-band voucher request using the shared SSE payment driver. */
export async function handleSseNeedVoucher(parameters, event) {
    const channel = parameters.driver.getChannel();
    if (!channel || !parameters.challenge)
        return;
    const resolution = await resolveNeedVoucherContext({
        assertVoucherWithinLocalLimit: parameters.driver.assertVoucherWithinLocalLimit,
        challenge: parameters.challenge,
        event,
        expectedChannelId: channel.channelId,
        getChannel: parameters.driver.getChannel,
        input: parameters.input,
        topUpIfNeeded: parameters.driver.topUpIfNeeded,
    });
    if (resolution.status !== 'ready')
        return;
    const voucherResponse = await postManagementCredential({
        challenge: parameters.challenge,
        context: resolution.context,
        createSessionCredential: parameters.driver.createSessionCredential,
        fetch: parameters.driver.fetch,
        input: parameters.input,
    });
    if (!voucherResponse.ok) {
        throw new Error(`Voucher POST failed with status ${voucherResponse.status}`);
    }
}
/** Probes a WebSocket endpoint over HTTP and returns its current session challenge. */
export async function probeWebSocketSession(parameters) {
    const wsUrl = new URL(parameters.input.toString());
    const httpUrl = webSocketProbeUrl(wsUrl);
    parameters.onProbeUrl?.(httpUrl);
    const probe = await parameters.fetch(httpUrl, {
        ...parameters.probeInit,
        ...(parameters.signal ? { signal: parameters.signal } : {}),
    });
    if (probe.status !== 402) {
        throw new Error(`Expected a 402 payment challenge from ${httpUrl}, received ${probe.status} instead.`);
    }
    const challenge = Challenge.fromResponseList(probe).find(isTip1034SessionChallenge);
    if (!challenge) {
        throw new Error('No payment challenge received from HTTP endpoint for this WebSocket URL. The server may not require payment or did not advertise a challenge.');
    }
    return {
        challenge,
        httpUrl,
        wsUrl,
    };
}
/** Probes a WebSocket endpoint over HTTP and creates the opening credential. */
export async function prepareWebSocketSession(parameters) {
    const probed = await probeWebSocketSession(parameters);
    return {
        ...probed,
        credential: await parameters.createSessionCredential(probed.challenge, {}),
    };
}
/** Creates the initial runtime state for a paid WebSocket from its opening credential. */
export function createActiveSocketSession(parameters) {
    const { challenge, credential, socket } = parameters;
    return {
        challenge,
        channelId: PaymentCredential.deserialize(credential).payload.channelId,
        closeReadyReceipt: null,
        deliveredChunks: 0n,
        expectedCloseAmount: null,
        socket,
        tickCost: readSessionChallengeAmount(challenge),
    };
}
/** Returns whether a receipt belongs to the active WebSocket session. */
export function isExpectedSocketReceipt(parameters) {
    const { challengeId, channelId, receipt } = parameters;
    return receipt.challengeId === challengeId && receipt.channelId === channelId;
}
/** Returns a protocol failure message when a close-ready receipt is invalid. */
export function validateSocketCloseReadyReceipt(parameters) {
    if (!isExpectedSocketReceipt(parameters))
        return 'received mismatched payment-close-ready frame';
    const spent = Ws.parseUint96Amount(parameters.receipt.spent);
    if (spent === undefined)
        return 'received invalid payment-close-ready spend';
    if (spent > parameters.cumulativeAmount) {
        return 'received payment-close-ready beyond local voucher state';
    }
    return undefined;
}
/** Returns a protocol failure message when a payment receipt is invalid. */
export function validateSocketPaymentReceipt(parameters) {
    const { challengeId, channelId, expectedCloseAmount, receipt } = parameters;
    if (!isExpectedSocketReceipt(parameters))
        return 'received mismatched payment-receipt frame';
    if (expectedCloseAmount !== null &&
        Boolean(receipt.txHash) &&
        !isExpectedCloseReceipt({
            challengeId,
            channelId,
            expectedCloseAmount,
            minimumSpent: BigInt(expectedCloseAmount),
            receipt,
        })) {
        return 'received mismatched payment-close receipt frame';
    }
    return undefined;
}
/**
 * Opens an auto-driving paid WebSocket session.
 *
 * The driver owns socket protocol frames. Session state, credential creation,
 * and top-up policy remain supplied by `SessionManager`.
 */
export async function openWebSocketSession(parameters) {
    const { challenge, credential, options, WebSocket: WebSocketImpl, wsUrl } = parameters;
    const rawSocket = new WebSocketImpl(wsUrl, options?.protocols);
    const socketState = createActiveSocketSession({
        challenge,
        credential,
        socket: rawSocket,
    });
    parameters.setSocketSession(socketState);
    const managedSocket = createManagedSocket(rawSocket);
    const failSocketFlow = (message) => {
        parameters.rejectReceipt(new Error(message));
        parameters.rejectCloseReady(new Error(message));
        if (rawSocket.readyState === WebSocketReadyState.CONNECTING ||
            rawSocket.readyState === WebSocketReadyState.OPEN) {
            rawSocket.close(ClientWebSocketProtocolErrorCloseCode, message);
        }
    };
    rawSocket.addEventListener('close', (event) => {
        socketState.socket = null;
        socketState.expectedCloseAmount = null;
        parameters.rejectReceipt(new Error('WebSocket closed before the payment flow completed.'));
        parameters.rejectCloseReady(new Error('WebSocket closed before the payment flow completed.'));
        managedSocket.emit('close', {
            code: event.code ?? 1000,
            reason: event.reason ?? '',
            type: 'close',
            wasClean: true,
        });
    });
    rawSocket.addEventListener('error', () => {
        managedSocket.emit('error', { type: 'error' });
    });
    rawSocket.addEventListener('message', async (event) => {
        const raw = typeof event.data === 'string' ? event.data : undefined;
        if (!raw)
            return;
        await handleSocketMessage({
            driver: parameters,
            failSocketFlow,
            managedEmit: managedSocket.emit,
            message: raw,
            rawSocket,
            socketState,
        });
    });
    options?.signal?.addEventListener('abort', () => {
        parameters.rejectReceipt(new Error('WebSocket payment flow aborted.'));
        parameters.rejectCloseReady(new Error('WebSocket payment flow aborted.'));
        rawSocket.close();
    }, { once: true });
    await waitForSocketOpen(rawSocket, managedSocket.emit, wsUrl);
    rawSocket.send(Ws.formatAuthorizationMessage(credential));
    await parameters.waitForReceipt();
    return managedSocket.socket;
}
function waitForSocketOpen(rawSocket, managedEmit, wsUrl) {
    return new Promise((resolve, reject) => {
        const onOpen = () => {
            rawSocket.removeEventListener('error', onError);
            managedEmit('open', { type: 'open' });
            resolve();
        };
        const onError = () => {
            rawSocket.removeEventListener('open', onOpen);
            reject(new Error(`WebSocket connection to ${wsUrl} failed to open.`));
        };
        rawSocket.addEventListener('open', onOpen, { once: true });
        rawSocket.addEventListener('error', onError, { once: true });
    });
}
async function handleSocketMessage(parameters) {
    const parsed = Ws.parseMessage(parameters.message);
    if (!parsed) {
        parameters.managedEmit('message', { data: parameters.message, type: 'message' });
        return;
    }
    switch (parsed.mpp) {
        case 'authorization':
            return;
        case 'message':
            parameters.socketState.deliveredChunks += 1n;
            parameters.managedEmit('message', { data: parsed.data, type: 'message' });
            return;
        case 'payment-close-ready':
            handleCloseReady(parameters, parsed.data);
            return;
        case 'payment-error':
            parameters.driver.rejectReceipt(new Error(parsed.message));
            parameters.driver.rejectCloseReady(new Error(parsed.message));
            return;
        case 'payment-need-voucher':
            await handleNeedVoucher(parameters, parsed.data);
            return;
        case 'payment-receipt':
            handleReceipt(parameters, parsed.data);
            return;
    }
}
function handleCloseReady(parameters, receipt) {
    const cumulativeAmount = parameters.driver.getChannel()?.cumulativeAmount ?? 0n;
    const error = validateSocketCloseReadyReceipt({
        challengeId: parameters.driver.challenge.id,
        channelId: parameters.socketState.channelId,
        cumulativeAmount,
        receipt,
    });
    if (error) {
        parameters.failSocketFlow(error);
        return;
    }
    parameters.driver.acceptReceipt(receipt);
    parameters.driver.options?.onReceipt?.(receipt);
    parameters.driver.settleCloseReady(receipt);
    parameters.managedEmit('close', {
        code: 1000,
        reason: 'stream complete',
        type: 'close',
        wasClean: true,
    });
}
async function handleNeedVoucher(parameters, event) {
    try {
        let challenge = parameters.driver.challenge;
        if (challenge.expires &&
            new Date(challenge.expires).getTime() <= Date.now() + webSocketChallengeRefreshWindowMs) {
            challenge = await parameters.driver.refreshChallenge();
            parameters.driver.challenge = challenge;
            parameters.socketState.challenge = challenge;
        }
        const resolution = await resolveNeedVoucherContext({
            assertVoucherWithinLocalLimit: parameters.driver.assertVoucherWithinLocalLimit,
            challenge,
            event,
            expectedChannelId: parameters.socketState.channelId,
            getChannel: parameters.driver.getChannel,
            input: parameters.driver.httpUrl,
            topUpIfNeeded: parameters.driver.topUpIfNeeded,
        });
        if (resolution.status === 'ignored') {
            parameters.failSocketFlow(resolution.reason === 'channel-mismatch'
                ? 'received mismatched payment-need-voucher frame'
                : 'cannot create voucher: no active channel');
            return;
        }
        const voucher = await parameters.driver.createSessionCredential(challenge, resolution.context);
        parameters.rawSocket.send(Ws.formatAuthorizationMessage(voucher));
    }
    catch (error) {
        parameters.failSocketFlow(error instanceof Error ? error.message : 'failed to create websocket voucher');
    }
}
function handleReceipt(parameters, receipt) {
    const error = validateSocketPaymentReceipt({
        challengeId: parameters.driver.challenge.id,
        channelId: parameters.socketState.channelId,
        expectedCloseAmount: parameters.socketState.expectedCloseAmount,
        receipt,
    });
    if (error) {
        parameters.failSocketFlow(error);
        return;
    }
    parameters.driver.acceptReceipt(receipt);
    parameters.driver.options?.onReceipt?.(receipt);
    parameters.driver.settleReceipt(receipt);
}
//# sourceMappingURL=Transports.js.map