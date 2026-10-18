import type { Hex } from 'ox';
import { type Address } from 'viem';
import * as Account from '../../../viem/Account.js';
import * as Client from '../../../viem/Client.js';
import { type ChannelStore } from '../client/ChannelStore.js';
import { type SessionContext } from '../client/CredentialState.js';
import { session as sessionPlugin } from '../client/Session.js';
import type { SessionReceipt } from '../precompile/Protocol.js';
import { deserializeSnapshot as deserializeSessionSnapshot, serializeSnapshot as serializeSessionSnapshot } from '../Snapshot.js';
import type { SessionState } from './Runtime.js';
import { type TempoSessionChallenge } from './Transports.js';
import { type SessionManagedWebSocket, type WebSocketConstructor } from './Transports.js';
import { type SseDriverOptions } from './Transports.js';
import { type WebSocketDriverOptions } from './Transports.js';
export { computeFallbackCloseAmount, type FallbackCloseAmountParameters } from './Runtime.js';
/** Auto-driving client manager for HTTP, SSE, and WebSocket TIP-1034 sessions. */
export type SessionManager = {
    /** Active channel ID, when a channel has been opened or recovered. */
    readonly channelId: Hex.Hex | undefined;
    /** Local cumulative voucher authorization in raw token units. */
    readonly cumulative: bigint;
    /** Whether the manager currently has an open local channel. */
    readonly opened: boolean;
    /** Current pure session state-machine state. */
    readonly state: SessionState;
    /** Runs the HTTP 402 probe, signs/open/top-ups as needed, retries, and returns receipt metadata. */
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<PaymentResponse>;
    /** Opens a paid SSE stream and auto-posts vouchers/top-ups when the server requests more headroom. */
    sse(input: RequestInfo | URL, init?: SessionManagerSseOptions): Promise<AsyncIterable<string>>;
    /** Opens a paid WebSocket session after an HTTP challenge probe and manages in-band voucher frames. */
    ws(input: string | URL, init?: SessionManagerWebSocketOptions): Promise<SessionManagedWebSocket>;
    /** Tops up the active channel deposit. String amounts are parsed with the manager decimals; bigint amounts are raw units. */
    topUp(amount: string | bigint): Promise<SessionReceipt | undefined>;
    /** Cooperatively closes the active channel using the latest locally authorized spend boundary. */
    close(): Promise<SessionReceipt | undefined>;
};
/** Options for `SessionManager.sse()`. */
export type SessionManagerSseOptions = SseDriverOptions;
/** Options for `SessionManager.ws()`. */
export type SessionManagerWebSocketOptions = WebSocketDriverOptions;
/** HTTP response enriched with the latest session payment metadata. */
export type PaymentResponse = Response & {
    /** Parsed payment receipt, when the response included one. */
    receipt: SessionReceipt | null;
    /** Last session challenge observed by the manager. */
    challenge: TempoSessionChallenge | null;
    /** Active channel ID, when available. */
    channelId: Hex.Hex | null;
    /** Local cumulative voucher authorization in raw token units. */
    cumulative: bigint;
};
/** @internal Merges manager-wide context without allowing it to replace an operation's fields. */
export declare function mergeSessionCredentialContext(credentialContext: unknown, operationContext: SessionContext): SessionContext;
/**
 * Creates a session manager that handles the full client payment lifecycle:
 * channel open, incremental vouchers, SSE streaming, and channel close.
 *
 * Internally delegates to the `session()` method for all
 * channel state management and credential creation, and to `Fetch.from`
 * for the 402 challenge/retry flow.
 *
 * `channelStore` can persist reusable channels between manager instances.
 */
export declare function sessionManager(parameters: sessionManager.Parameters): SessionManager;
/** Type helpers for `sessionManager()`. */
export declare namespace sessionManager {
    const serializeSnapshot: typeof serializeSessionSnapshot;
    const deserializeSnapshot: typeof deserializeSessionSnapshot;
    type Parameters = Account.getResolver.Parameters & Client.getResolver.Parameters & {
        /** Accept a noncanonical escrow contract advertised by the server. @default false */
        allowCustomEscrow?: boolean | undefined;
        /** Automatically acquire the session currency from fallback stablecoins before open/top-up. */
        autoSwap?: sessionPlugin.Parameters['autoSwap'];
        /** Enables same-route HEAD bootstrap from a server session snapshot before opening a new channel. */
        bootstrap?: boolean | undefined;
        /** Viem client instance. Shorthand for `getClient: () => client`. */
        client?: import('viem').Client | undefined;
        /** Token decimals used to convert `maxDeposit` to raw units. Defaults to `6`. */
        decimals?: number | undefined;
        /** Exact TIP20EscrowChannel address pin. Takes precedence over `allowCustomEscrow`. */
        escrow?: Address | undefined;
        /**
         * Chains permitted for sessions, bootstrap proofs, and snapshots. Omitted allows any
         * chain; empty rejects all. A single entry supplies an omitted challenge chain;
         * otherwise the challenge or resolved client must select an allowed chain.
         */
        allowedChainIds?: readonly number[] | undefined;
        /** Fetch implementation used for HTTP probes, management posts, and paid retries. */
        fetch?: typeof globalThis.fetch | undefined;
        /** Base context supplied to every session credential created by the manager. */
        credentialContext?: unknown;
        /** Maximum deposit in human-readable units (e.g. `'10'` for 10 tokens). Converted to raw units via `decimals`. */
        maxDeposit?: string | undefined;
        /**
         * Preferred automatic top-up size in human-readable units. When omitted,
         * a bounded server `suggestedDeposit` is preferred, then the exact shortfall.
         */
        topUpAmount?: string | undefined;
        /** Selects the account that signs session credentials. */
        resolveAccount?: sessionPlugin.ResolveAccount | undefined;
        /** Store for reusable session channels. Defaults to in-memory. */
        channelStore?: ChannelStore | undefined;
        /** Optional websocket constructor for runtimes without a global WebSocket. */
        webSocket?: WebSocketConstructor | undefined;
    };
}
//# sourceMappingURL=SessionManager.d.ts.map