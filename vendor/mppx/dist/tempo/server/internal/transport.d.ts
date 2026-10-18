import * as Transport from '../../../server/Transport.js';
import type { SessionReceipt } from '../../session/precompile/Protocol.js';
import * as ChannelStore from '../../session/server/ChannelStore.js';
import type { SettleChargedSessionChannel } from '../../session/server/Settlement.js';
import * as Sse_core from '../../session/server/Sse.js';
declare const prepaidSessionTick: unique symbol;
/** SSE transport with Tempo session controller. */
export type Sse = Transport.Sse<Sse_core.SessionController>;
/** Receipt marker used to avoid double-charging a request already charged during verification. */
export type PrepaidSessionReceipt = SessionReceipt & {
    [prepaidSessionTick]?: true | undefined;
};
/** Marks a session receipt as already charged for the current request. */
export declare function markPrepaidSessionTick(receipt: SessionReceipt): SessionReceipt;
/**
 * Creates a Tempo-metered SSE transport.
 *
 * Wraps an HTTP transport with:
 * - Context capture from credentials (channelId, tickCost)
 * - Per-token charging via Sse.serve for generator/iterable responses
 * - Auto-detection of upstream SSE responses
 * - Fallback to standard HTTP receipt handling for plain Response
 */
export declare function sse(options: sse.Options & {
    settleCharged?: SettleChargedSessionChannel | undefined;
    store: ChannelStore.ChannelStore;
}): Sse;
/** Type helpers for the Tempo SSE transport adapter. */
export declare namespace sse {
    type Options = {
        /**
         * When true, the charge loop uses polling instead of `waitForUpdate()`.
         *
         * Required for runtimes like Cloudflare Workers where resolving promises
         * across request contexts is not supported. Without this flag, a mid-stream
         * voucher POST (Request B) would resolve a waiter created in the streaming
         * request context (Request A), causing a Workers error.
         *
         * @default false
         */
        poll?: boolean | undefined;
        /** Polling interval (in milliseconds). @default 10 */
        pollingInterval?: number | undefined;
    };
}
type DefaultServeGenerate = AsyncIterable<string> | (() => AsyncIterable<string>);
/** Default SSE serve: iterates values and emits `event: message` per value. */
export declare function defaultServe(options: {
    generate: DefaultServeGenerate;
    challengeId: string;
}): Response;
export {};
//# sourceMappingURL=transport.d.ts.map