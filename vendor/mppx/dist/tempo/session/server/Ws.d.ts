import * as ChannelStore from './ChannelStore.js';
import type { MeteredStreamOptions, SessionController } from './MeteredStream.js';
import type { SettleChargedSessionChannel } from './Settlement.js';
export type { SessionController } from './MeteredStream.js';
export type { Socket } from './Transports.js';
import { type Socket } from './Transports.js';
/** Public WebSocket payment frame helpers. */
export { formatApplicationMessage, formatAuthorizationMessage, formatCloseReadyMessage, formatCloseRequestMessage, formatErrorMessage, formatNeedVoucherMessage, formatReceiptMessage, parseMessage, type ErrorMessageParameters, type Message, } from '../precompile/Protocol.js';
/** Result returned by an HTTP route before upgrading or authorizing a WebSocket session. */
export type SessionRouteResult = {
    status: 402;
    challenge: Response;
} | {
    status: 200;
    withReceipt(response?: Response): Response;
};
/** HTTP route used to perform a WebSocket payment probe. */
export type SessionRoute = (request: Request) => Promise<SessionRouteResult>;
/**
 * Bridge a WebSocket connection to a Tempo session payment flow.
 *
 * Credential verification is performed by routing each in-band authorization
 * frame through `route` as a **synthetic `POST` request** that carries only
 * the `Authorization` header. The synthetic request does not include cookies,
 * bodies, query parameters, or other headers from the original WebSocket
 * upgrade request. Do not wrap `route` with middleware that depends on
 * HTTP-specific context beyond the `Authorization` header.
 */
export declare function serve(options: serve.Options): Promise<void>;
/** Type helpers for {@link serve}. */
export declare namespace serve {
    type Options = {
        /** Expected per-tick amount in raw units. When set, credentials whose
         *  challenge `request.amount` does not match are rejected. Use this to
         *  pin the price when the route is backed by `Mppx.compose()` with
         *  multiple offers — otherwise a client can select the cheapest offer
         *  and still receive the same stream. */
        amount?: string | undefined;
        /** Application stream. A manual stream can call `charge(amount)` with a
         *  per-message raw-unit amount; omitting it uses the challenge tick cost. */
        generate: AsyncIterable<string> | ((stream: SessionController) => AsyncIterable<string>);
        pollIntervalMs?: number | undefined;
        /** Payment route handler. Receives synthetic `POST` requests with only
         *  the `Authorization` header — no cookies, bodies, or upgrade headers. */
        route: SessionRoute;
        /** Optional low-level hook invoked after each committed stream charge. */
        onChargeCommitted?: MeteredStreamOptions['onChargeCommitted'];
        /** @deprecated Use `onChargeCommitted`. */
        settleScheduled?: SettleChargedSessionChannel | undefined;
        socket: Socket;
        store: ChannelStore.ChannelStore | import('../../../Store.js').Store;
        url: string | URL;
    };
}
//# sourceMappingURL=Ws.d.ts.map