import type { Hex } from 'ox';
import { type Account as viem_Account, type Address } from 'viem';
import * as Challenge from '../../../Challenge.js';
import * as AcceptPayment from '../../../internal/AcceptPayment.js';
import type * as Account from '../../../viem/Account.js';
import type * as Client from '../../../viem/Client.js';
import type { SessionReceipt } from '../../session/precompile/Protocol.js';
import { session as sessionPlugin } from './Session.js';
type WebSocketConstructor = {
    new (url: string | URL, protocols?: string | string[]): WebSocket;
};
type SessionMethod = ReturnType<typeof sessionPlugin>;
type SessionOrderChallenges = AcceptPayment.OrderChallenges<readonly [SessionMethod]>;
type SessionRequestInit = RequestInit & {
    orderChallenges?: SessionOrderChallenges | undefined;
};
/** Auto-driving legacy client manager for HTTP, SSE, and WebSocket sessions. */
export type SessionManager = {
    /** Active legacy channel ID, when opened or recovered. */
    readonly channelId: Hex.Hex | undefined;
    /** Local cumulative voucher authorization in raw token units. */
    readonly cumulative: bigint;
    /** Whether the manager currently has an open local channel. */
    readonly opened: boolean;
    /** Opens a legacy contract-backed channel before the first paid request. */
    open(options?: {
        deposit?: bigint;
    }): Promise<void>;
    /** Performs the HTTP 402 challenge/retry flow and returns receipt metadata. */
    fetch(input: RequestInfo | URL, init?: SessionRequestInit): Promise<PaymentResponse>;
    /** Opens a paid SSE stream and responds to voucher requests. */
    sse(input: RequestInfo | URL, init?: SessionRequestInit & {
        onReceipt?: ((receipt: SessionReceipt) => void) | undefined;
        signal?: AbortSignal | undefined;
    }): Promise<AsyncIterable<string>>;
    /** Opens a paid WebSocket session and manages in-band payment frames. */
    ws(input: string | URL, init?: {
        onReceipt?: ((receipt: SessionReceipt) => void) | undefined;
        orderChallenges?: SessionOrderChallenges | undefined;
        protocols?: string | string[] | undefined;
        signal?: AbortSignal | undefined;
    }): Promise<WebSocket>;
    /** Cooperatively closes the active legacy channel. */
    close(): Promise<SessionReceipt | undefined>;
};
/** HTTP response enriched with latest legacy session metadata. */
export type PaymentResponse = Response & {
    /** Parsed payment receipt, when the response included one. */
    receipt: SessionReceipt | null;
    /** Last session challenge observed by the manager. */
    challenge: Challenge.Challenge | null;
    /** Active channel ID, when available. */
    channelId: Hex.Hex | null;
    /** Local cumulative voucher authorization in raw token units. */
    cumulative: bigint;
};
/**
 * Creates a session manager that handles the full client payment lifecycle:
 * channel open, incremental vouchers, SSE streaming, and channel close.
 *
 * Internally delegates to the `session()` method for all
 * channel state management and credential creation, and to `Fetch.from`
 * for the 402 challenge/retry flow.
 *
 * ## Session resumption
 *
 * All channel state is held **in memory**. If the client process restarts,
 * the session is lost and a new on-chain channel will be opened on the next
 * request — the previous channel's deposit is orphaned until manually closed.
 *
 * When the server includes a `channelId` in the 402 challenge `methodDetails`,
 * the client will attempt to recover the channel by reading its on-chain state
 * via `getOnChainChannel()`. If the channel has a positive deposit and is not
 * finalized, it resumes from the on-chain settled amount.
 */
export declare function sessionManager(parameters: sessionManager.Parameters): SessionManager;
/** Type helpers for the legacy auto-driving session manager. */
export declare namespace sessionManager {
    type Parameters = Account.getResolver.Parameters & Client.getResolver.Parameters & {
        /** Accept a noncanonical escrow contract advertised by the server. @default false */
        allowCustomEscrow?: boolean | undefined;
        /** Account that signs voucher digests. Defaults to `account`; access-key accounts sign raw vouchers as their access-key address. */
        voucherSigner?: viem_Account | undefined;
        /** Viem client instance. Shorthand for `getClient: () => client`. */
        client?: import('viem').Client | undefined;
        /** Token decimals used to convert `maxDeposit` to raw units. Defaults to `6`. */
        decimals?: number | undefined;
        /** Exact escrow contract address pin. Takes precedence over `allowCustomEscrow`. */
        escrowContract?: Address | undefined;
        fetch?: typeof globalThis.fetch | undefined;
        /** Maximum deposit in human-readable units (e.g. `'10'` for 10 tokens). Converted to raw units via `decimals`. */
        maxDeposit?: string | undefined;
        /** Filters and sorts supported session challenges before credential creation. */
        orderChallenges?: SessionOrderChallenges | undefined;
        /** Optional websocket constructor for runtimes without a global WebSocket. */
        webSocket?: WebSocketConstructor | undefined;
    };
}
export {};
//# sourceMappingURL=SessionManager.d.ts.map