/**
 * Tempo-specific SSE transport that wraps the base HTTP transport
 * with metering logic (context capture from verified credentials, per-token
 * charging via Sse.serve).
 *
 * @internal
 */
import * as Challenge from '../../../Challenge.js';
import * as Constants from '../../../Constants.js';
import * as Errors from '../../../Errors.js';
import * as Transport from '../../../server/Transport.js';
import { requireSessionCredentialContext } from '../../session/precompile/Protocol.js';
import * as ChannelStore from '../../session/server/ChannelStore.js';
import * as Sse_core from '../../session/server/Sse.js';
import { captureRequestBodyProbe, shouldChargePlainResponse } from './request-body.js';
const prepaidSessionTick = Symbol('mppx.prepaidSessionTick');
/** Marks a session receipt as already charged for the current request. */
export function markPrepaidSessionTick(receipt) {
    Object.defineProperty(receipt, prepaidSessionTick, {
        configurable: false,
        enumerable: false,
        value: true,
    });
    return receipt;
}
function hasPrepaidSessionTick(receipt) {
    return receipt[prepaidSessionTick] === true;
}
/**
 * Creates a Tempo-metered SSE transport.
 *
 * Wraps an HTTP transport with:
 * - Context capture from credentials (channelId, tickCost)
 * - Per-token charging via Sse.serve for generator/iterable responses
 * - Auto-detection of upstream SSE responses
 * - Fallback to standard HTTP receipt handling for plain Response
 */
export function sse(options) {
    const { pollingInterval, poll } = options;
    // When `poll` is true, strip `waitForUpdate` so the SSE charge loop
    // falls back to polling. This is needed for runtimes like Cloudflare Workers
    // where resolving promises across request contexts is not supported.
    const store = (() => {
        if (!poll)
            return options.store;
        const { waitForUpdate: _, ...store } = options.store;
        return store;
    })();
    const base = Transport.http();
    return Transport.from({
        name: 'sse',
        captureRequest(request) {
            return (base.captureRequest?.(request) ?? {
                headers: new Headers(request.headers),
                hasBody: request.body !== null,
                method: request.method,
                url: new URL(request.url),
            });
        },
        getCredential(request) {
            return base.getCredential(request);
        },
        respondChallenge(options) {
            return base.respondChallenge(options);
        },
        respondReceipt({ credential, envelope, receipt, response, challengeId, input }) {
            const verifiedCredential = envelope?.credential ?? credential;
            const verifiedChallengeId = envelope?.challenge.id ?? challengeId;
            const verifiedRequest = envelope?.request ?? verifiedCredential.challenge.request;
            const payload = requireSessionCredentialContext(verifiedCredential.payload, 'No SSE context available');
            const channelId = payload.channelId;
            const tickCost = BigInt(verifiedCredential.challenge.request.amount);
            const unitType = typeof verifiedRequest.unitType === 'string' ? verifiedRequest.unitType : undefined;
            // Auto-detect upstream SSE responses and parse them into an
            // AsyncIterable so they flow through the metered pipeline.
            // This lets proxy consumers simply pass `result.withReceipt(upstreamRes)`
            // and get per-event charging automatically.
            const resolved = response instanceof Response && Sse_core.isEventStream(response) && response.body
                ? Sse_core.iterateData(response, { skip: (d) => d === '[DONE]' })
                : response;
            if (isAsyncGeneratorFunction(resolved) || isAsyncIterable(resolved)) {
                // Pass async generator functions directly so Sse.serve gives them
                // a SessionController for manual charge(). Pass raw AsyncIterables
                // as-is so Sse.serve auto-charges per yielded value.
                const generate = resolveMeteredGenerate(resolved, unitType);
                const stream = Sse_core.serve({
                    store,
                    channelId,
                    challengeId: verifiedChallengeId,
                    tickCost,
                    pollIntervalMs: pollingInterval,
                    generate,
                    onChargeCommitted: options.settleCharged,
                    prepaidUnits: hasPrepaidSessionTick(receipt) ? 1 : 0,
                    signal: input.signal,
                });
                return Sse_core.toResponse(stream);
            }
            const baseResponse = base.respondReceipt({
                credential: verifiedCredential,
                envelope,
                input,
                receipt,
                response: response,
                challengeId: verifiedChallengeId,
            });
            const request = envelope?.capturedRequest ?? captureRequestBodyProbe(input);
            if (!shouldChargePlainResponse(request, payload)) {
                return baseResponse;
            }
            const currentReceipt = receipt;
            if (hasPrepaidSessionTick(currentReceipt)) {
                return baseResponse;
            }
            const available = BigInt(currentReceipt.acceptedCumulative) - BigInt(currentReceipt.spent);
            if (available < tickCost) {
                const error = new Errors.InsufficientBalanceError({
                    reason: `requested ${tickCost}, available ${available}`,
                });
                return new Response(JSON.stringify(error.toProblemDetails(verifiedCredential.challenge.id)), {
                    status: error.status,
                    headers: {
                        [Constants.Headers.wwwAuthenticate]: Challenge.serialize(verifiedCredential.challenge),
                        'Cache-Control': 'no-store',
                        'Content-Type': 'application/problem+json',
                    },
                });
            }
            const chargedReceipt = {
                ...currentReceipt,
                spent: (BigInt(currentReceipt.spent) + tickCost).toString(),
                units: (currentReceipt.units ?? 0) + 1,
            };
            const chargedResponse = base.respondReceipt({
                credential: verifiedCredential,
                envelope,
                input,
                receipt: chargedReceipt,
                response: response,
                challengeId: verifiedChallengeId,
            });
            const chargePlainResponse = async () => {
                const result = await ChannelStore.deductFromChannel(store, channelId, tickCost);
                if (result.ok)
                    await options.settleCharged?.(result.channel);
                return result;
            };
            // Non-SSE response (e.g. upstream returned JSON instead of event-stream).
            // Need to deduct tickCost so request isn't free.
            // For null-body statuses, the request shape determines whether the
            // response is management (no charge) or plain content (charge one tick).
            if (isNullBodyStatus(chargedResponse.status)) {
                void chargePlainResponse();
                return chargedResponse;
            }
            const stream = new ReadableStream({
                async start(controller) {
                    // deduction completes before consumer reads
                    const result = await chargePlainResponse();
                    if (!result.ok) {
                        controller.error(new Errors.InsufficientBalanceError({
                            reason: `requested ${tickCost}, available ${result.channel.highestVoucherAmount - result.channel.spent}`,
                        }));
                        return;
                    }
                    if (!chargedResponse.body) {
                        controller.close();
                        return;
                    }
                    const reader = chargedResponse.body.getReader();
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done)
                                break;
                            controller.enqueue(value);
                        }
                    }
                    finally {
                        reader.releaseLock();
                        controller.close();
                    }
                },
            });
            return new Response(stream, {
                status: chargedResponse.status,
                statusText: chargedResponse.statusText,
                headers: chargedResponse.headers,
            });
        },
    });
}
/** Default SSE serve: iterates values and emits `event: message` per value. */
export function defaultServe(options) {
    const iterable = typeof options.generate === 'function' ? options.generate() : options.generate;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            try {
                for await (const value of iterable) {
                    controller.enqueue(encoder.encode(Sse_core.formatMessageEvent(value)));
                }
            }
            catch (e) {
                controller.error(e);
            }
            finally {
                controller.close();
            }
        },
    });
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    });
}
function isAsyncGeneratorFunction(value) {
    if (typeof value !== 'function')
        return false;
    return value.constructor?.name === 'AsyncGeneratorFunction';
}
function isAsyncIterable(value) {
    return value !== null && typeof value === 'object' && Symbol.asyncIterator in value;
}
function resolveMeteredGenerate(value, unitType) {
    if (isAsyncGeneratorFunction(value))
        return value;
    if (unitType !== 'request')
        return value;
    const iterable = value;
    return async function* chargeOnce(stream) {
        let charged = false;
        for await (const chunk of iterable) {
            if (!charged) {
                await stream.charge();
                charged = true;
            }
            yield chunk;
        }
    };
}
function isNullBodyStatus(status) {
    return [101, 204, 205, 304].includes(status);
}
//# sourceMappingURL=transport.js.map