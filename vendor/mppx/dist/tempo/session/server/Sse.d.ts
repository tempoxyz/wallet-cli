import type { Hex } from 'viem';
import * as ChannelStore from './ChannelStore.js';
import { type MeteredStreamOptions, type SessionController } from './MeteredStream.js';
/**
 * SSE (Server-Sent Events) utilities for metered streaming payments.
 *
 * Provides event formatting/parsing, balance polling, the core
 * `serve()` loop that meters an async iterable into a ReadableStream
 * of SSE events, and helpers (`toResponse`, `fromRequest`) for
 * building HTTP responses from the stream.
 */
export { extractData, formatMessageEvent, formatNeedVoucherEvent, formatReceiptEvent, parseEvent, readSessionChallengeAmount, requireSessionCredentialContext, type SseEvent, } from '../precompile/Protocol.js';
/** Controller passed to manual-charge SSE generators. */
export type { SessionController } from './MeteredStream.js';
/**
 * Wrap an async iterable with payment metering, producing an SSE stream.
 *
 * `generate` may be either:
 * - An `AsyncIterable<string>` — each yielded value is automatically charged
 *   (one `tickCost` per value).
 * - A callback `(stream: SessionController) => AsyncIterable<string>` — the
 *   generator controls when charges happen by calling `stream.charge()`.
 *
 * For each emitted value the stream:
 * 1. Reserves `tickCost` from the channel's available voucher headroom
 *    (auto or manual).
 * 2. If balance is sufficient, emits `event: message` with the value.
 * 3. If balance is exhausted, emits `event: payment-need-voucher`
 *    and polls store until the client tops up the channel.
 * 4. Commits the reserved charge immediately before the chunk is emitted.
 * 5. On generator completion, emits a final `event: payment-receipt`.
 *
 * Returns a `ReadableStream<Uint8Array>` suitable for use as an HTTP response body.
 */
export declare function serve(options: serve.Options): ReadableStream<Uint8Array>;
/** Type helpers for {@link serve}. */
export declare namespace serve {
    type Options = {
        store: ChannelStore.ChannelStore;
        channelId: Hex;
        challengeId: string;
        tickCost: bigint;
        generate: AsyncIterable<string> | ((stream: SessionController) => AsyncIterable<string>);
        /** Callback invoked after each nonzero stream charge is committed. */
        onChargeCommitted?: MeteredStreamOptions['onChargeCommitted'];
        pollIntervalMs?: number | undefined;
        prepaidUnits?: number | undefined;
        signal?: AbortSignal | undefined;
    };
}
/**
 * Wrap a `ReadableStream<Uint8Array>` (from {@link serve}) in an HTTP
 * `Response` with the correct SSE headers.
 */
export declare function toResponse(body: ReadableStream<Uint8Array>): Response;
/**
 * Extract `channelId`, `challengeId`, and `tickCost` from a `Request`'s
 * `Authorization: Payment …` header.
 *
 * This is a convenience for callers that receive a raw `Request` and need
 * the parameters required by {@link serve}.
 */
export declare function fromRequest(request: Request): fromRequest.Context;
/** Type helpers for {@link fromRequest}. */
export declare namespace fromRequest {
    type Context = {
        challengeId: string;
        channelId: Hex;
        tickCost: bigint;
    };
}
/**
 * Check whether a `Response` carries an SSE event stream.
 *
 * Returns `true` when the `Content-Type` header starts with
 * `text/event-stream` (case-insensitive, ignoring charset params).
 */
export declare function isEventStream(response: Response): boolean;
/**
 * Parse an SSE `Response` body into an async iterable of `data:` payloads.
 *
 * Yields the raw `data:` field content for each SSE event in the stream.
 * Events whose data matches the `skip` predicate are silently dropped
 * (e.g. `[DONE]` sentinels used by OpenAI-compatible APIs).
 *
 * Each yielded value typically becomes one charge tick when fed to
 * {@link serve} via the SSE transport's auto-charge mode.
 *
 * @example
 * ```ts
 * const upstream = await fetch('https://api.example.com/stream')
 * for await (const data of Sse.iterateData(upstream)) {
 *   console.log(data)
 * }
 * ```
 */
export declare function iterateData(response: Response, options?: iterateData.Options): AsyncGenerator<string>;
/** Type helpers for {@link iterateData}. */
export declare namespace iterateData {
    type Options = {
        /** Predicate to skip specific data payloads (e.g. `d => d === '[DONE]'`). */
        skip?: ((data: string) => boolean) | undefined;
    };
}
//# sourceMappingURL=Sse.d.ts.map