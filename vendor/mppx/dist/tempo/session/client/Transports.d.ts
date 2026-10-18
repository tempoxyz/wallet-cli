import { Hex } from 'ox';
import * as Challenge from '../../../Challenge.js';
import * as Constants from '../../../Constants.js';
import * as z from '../../../zod.js';
import * as Methods from '../../Methods.js';
import { type NeedVoucherEvent, type SessionReceipt } from '../precompile/Protocol.js';
import type { SessionSnapshot } from '../Snapshot.js';
import type { ChannelEntry } from './ChannelOps.js';
import type { SessionContext } from './CredentialState.js';
import { type CloseTarget, type SessionState } from './Runtime.js';
/** Runtime WebSocket constructor accepted by `sessionManager()` in non-browser environments. */
export type WebSocketConstructor = {
    new (url: string | URL, protocols?: string | string[]): WebSocket;
};
/** Numeric ready-state constants used by browser-compatible WebSocket clients. */
export declare const WebSocketReadyState: {
    readonly CONNECTING: 0;
    readonly OPEN: 1;
    readonly CLOSING: 2;
    readonly CLOSED: 3;
};
/** Client-side close code used for payment protocol errors. */
export declare const ClientWebSocketProtocolErrorCloseCode = 3008;
type EventType = 'close' | 'error' | 'message' | 'open';
type ManagedEventMap = {
    close: {
        code: number;
        reason: string;
        type: 'close';
        wasClean: boolean;
    };
    error: {
        type: 'error';
    };
    message: {
        data: string;
        type: 'message';
    };
    open: {
        type: 'open';
    };
};
type ListenerValue<type extends EventType = EventType> = ((event: ManagedEventMap[type]) => void) | {
    handleEvent(event: ManagedEventMap[type]): void;
};
type ManagedSocketShape = {
    onclose: ((event: ManagedEventMap['close']) => void) | null;
    onerror: ((event: ManagedEventMap['error']) => void) | null;
    onmessage: ((event: ManagedEventMap['message']) => void) | null;
    onopen: ((event: ManagedEventMap['open']) => void) | null;
};
/** Managed socket facade returned to callers after payment protocol frames are intercepted. */
export type SessionManagedWebSocket = ManagedSocketShape & {
    addEventListener<type extends EventType>(type: type, listener: ListenerValue<type>, options?: boolean | AddEventListenerOptions): void;
    readonly bufferedAmount: WebSocket['bufferedAmount'];
    close(code?: number, reason?: string): void;
    readonly extensions: WebSocket['extensions'];
    on<type extends EventType>(type: type, listener: (event: ManagedEventMap[type]) => void): void;
    off<type extends EventType>(type: type, listener: (event: ManagedEventMap[type]) => void): void;
    readonly protocol: WebSocket['protocol'];
    readonly readyState: WebSocket['readyState'];
    removeEventListener<type extends EventType>(type: type, listener: ListenerValue<type>): void;
    send(data: string): void;
    readonly url: WebSocket['url'];
};
/** Wraps a raw WebSocket so protocol frames can be handled before user listeners see messages. */
export declare function createManagedSocket(socket: WebSocket): {
    emit: <type extends EventType>(type: type, event: ManagedEventMap[type]) => void;
    socket: SessionManagedWebSocket;
};
/** Top-up requirement emitted by HTTP, SSE, or WebSocket session flows. */
export type TopUpRequirement = {
    /** Challenge used to authorize the management request. */
    challenge: TempoSessionChallenge;
    /** Channel that requires more deposit. */
    channelId: Hex.Hex;
    /** Current channel deposit in raw units. */
    deposit: bigint;
    /** Original paid resource URL; converted to a management URL by the caller. */
    input: RequestInfo | URL;
    /** Minimum cumulative voucher amount the server needs. */
    requiredCumulative: bigint;
};
/** Inputs needed to validate a caller-requested manager top-up. */
export type ResolveManualTopUpParameters = {
    /** Human-readable or raw top-up amount passed to `SessionManager.topUp()`. */
    amount: string | bigint;
    /** Local policy guard for cumulative voucher authorization. */
    assertVoucherWithinLocalLimit(cumulativeAmount: bigint): void;
    /** Active channel cache entry, when one exists. */
    channel: ChannelEntry | null;
    /** Token decimals used to parse string amounts. */
    decimals: number;
    /** Last challenge observed by the manager. */
    lastChallenge: TempoSessionChallenge | null;
    /** Last paid resource or management URL available to the manager. */
    lastUrl: RequestInfo | URL | null;
};
/** Validated target for a caller-requested manager top-up. */
export type ManualTopUpTarget = {
    /** Additional deposit in raw token units. */
    additionalDeposit: bigint;
    /** Challenge used to authorize the top-up credential. */
    challenge: TempoSessionChallenge;
    /** Channel ID receiving the top-up. */
    channelId: Hex.Hex;
    /** URL used for the top-up management POST. */
    input: RequestInfo | URL;
};
/** Inputs for applying a successful top-up POST to local manager state. */
export type ApplyTopUpResultParameters = {
    /** Additional deposit accepted by the top-up credential. */
    additionalDeposit: bigint;
    /** Active local channel cache entry, when one exists. */
    channel: ChannelEntry | null;
    /** Channel ID targeted by the top-up. */
    channelId: Hex.Hex;
    /** Current active challenge ID, used when the server did not return a receipt. */
    challengeId?: string | undefined;
    /** Current active machine state, used to preserve paid unit count when possible. */
    currentState: SessionState;
    /** Highest deposit known before the top-up. */
    knownDeposit?: bigint | undefined;
    /** Receipt returned by the top-up POST, when present. */
    receipt?: SessionReceipt | undefined;
    /** Latest locally observed spend in raw units. */
    spent: bigint;
};
/** Local runtime updates produced by a top-up POST. */
export type AppliedTopUpResult = {
    /** Channel with updated deposit. */
    channel: ChannelEntry;
    /** Next public machine state, when enough context is available to project one. */
    state?: SessionState | undefined;
};
/** Parsed raw-unit amounts from a server need-voucher event. */
export type NeedVoucherEventAmounts = {
    /** Highest voucher amount currently accepted by the server. */
    acceptedCumulative: bigint;
    /** Current on-chain deposit reported by the server. */
    deposit: bigint;
    /** Minimum cumulative voucher amount required by the server. */
    requiredCumulative: bigint;
};
/** Inputs used to satisfy a server need-voucher event. */
export type ResolveNeedVoucherContextParameters = {
    /** Local policy guard for cumulative voucher authorization. */
    assertVoucherWithinLocalLimit(cumulativeAmount: bigint): void;
    /** Challenge used for follow-up management credentials. */
    challenge: TempoSessionChallenge;
    /** Server need-voucher event. */
    event: NeedVoucherEvent;
    /** Expected channel ID for this transport flow. */
    expectedChannelId: Hex.Hex;
    /** Reads the latest active channel after any top-up. */
    getChannel(): ChannelEntry | null;
    /** Original paid resource URL; converted to management URL by the caller. */
    input: RequestInfo | URL;
    /** Performs the deposit top-up when server-required cumulative exceeds deposit. */
    topUpIfNeeded(parameters: TopUpRequirement): Promise<void>;
};
/** Result of handling a server need-voucher event. */
export type NeedVoucherResolution = {
    /** A voucher credential can be signed with this context. */
    status: 'ready';
    /** Context passed to the low-level session credential method. */
    context: SessionContext;
} | {
    /** No voucher should be sent for this event. */
    status: 'ignored';
    /** Why the event was ignored. */
    reason: 'channel-mismatch' | 'missing-channel';
};
/** Parses raw-unit numeric fields from a need-voucher event. */
export declare function readNeedVoucherEventAmounts(event: NeedVoucherEvent): NeedVoucherEventAmounts;
/** Validates local manager state and returns the concrete top-up operation to execute. */
export declare function resolveManualTopUp(parameters: ResolveManualTopUpParameters): ManualTopUpTarget;
/**
 * Applies local deposit and state bookkeeping for a top-up response.
 *
 * Deposit advances from the highest known baseline. Receipt cumulative values
 * only update accepted spend authorization; they do not replace deposit.
 */
export declare function applyTopUpResult(parameters: ApplyTopUpResultParameters): AppliedTopUpResult | undefined;
/**
 * Applies local top-up/cumulative bookkeeping for a need-voucher event and
 * returns an explicit transport decision.
 */
export declare function resolveNeedVoucherContext(parameters: ResolveNeedVoucherContextParameters): Promise<NeedVoucherResolution>;
/** Canonical challenge shape for built-in `tempo/session` requests. */
export type TempoSessionChallenge = Challenge.Challenge<z.output<typeof Methods.session.schema.request>, typeof Constants.Intents.session, typeof Constants.Methods.tempo>;
/** Creates a credential bound to the current session challenge. */
export type CreateSessionCredential = (challenge: TempoSessionChallenge, context: SessionContext) => Promise<string>;
/** Inputs for posting a precompile session top-up credential. */
export type PostTopUpParameters = {
    /** Additional deposit in raw token units. */
    additionalDeposit: bigint;
    /** Challenge used to authorize the management request. */
    challenge: TempoSessionChallenge;
    /** Local channel expected to receive the top-up. */
    channel: ChannelEntry | null;
    /** Channel ID being topped up. */
    channelId: Hex.Hex;
    /** Creates the signed top-up credential. */
    createSessionCredential: CreateSessionCredential;
    /** Fetch implementation used for the management POST. */
    fetch: typeof globalThis.fetch;
    /** Original paid resource URL; normalized to a management URL before posting. */
    input: RequestInfo | URL;
};
/** Inputs for retrying an HTTP 402 with a top-up/voucher management round trip. */
export type RetryHttpPaymentRequiredParameters = {
    /** Creates the signed voucher credential. */
    createSessionCredential: CreateSessionCredential;
    /** Fetch implementation used for the paid retry. */
    fetch: typeof globalThis.fetch;
    /** Returns the current active channel after any top-up side effects. */
    getChannel(): ChannelEntry | null;
    /** Original request init used by the paid resource request. */
    init?: RequestInit | undefined;
    /** Original paid resource URL. */
    input: RequestInfo | URL;
    /** Failed HTTP response that may contain a session challenge. */
    response: Response;
    /** Restores local cumulative authorization if the voucher retry fails. */
    restoreCumulative(channelId: Hex.Hex, cumulativeAmount: bigint): void | Promise<void>;
    /** Stores the selected follow-up challenge on the manager. */
    setChallenge(challenge: TempoSessionChallenge): void;
    /** Performs automatic top-up before the voucher retry when deposit is insufficient. */
    topUpIfNeeded(parameters: TopUpRequirement): Promise<void>;
};
/** Resolved data needed to perform an automatic HTTP voucher retry. */
export type RetryHttpPaymentContext = {
    /** Channel active before the retry attempt. */
    channel: ChannelEntry;
    /** Follow-up challenge selected from the 402 response. */
    challenge: TempoSessionChallenge;
    /** Server snapshot describing the required voucher boundary. */
    snapshot: NonNullable<ReturnType<typeof getSessionSnapshot>>;
};
/** Inputs for posting a cooperative HTTP close credential. */
export type CloseHttpSessionParameters = {
    /** Creates the signed close credential. */
    createSessionCredential: CreateSessionCredential;
    /** Fetch implementation used for the close POST. */
    fetch: typeof globalThis.fetch;
    /** Last paid resource URL; used as the management endpoint base. */
    lastUrl: RequestInfo | URL | null;
    /** Returns the latest cumulative spend already confirmed by the client. */
    getMinimumSpent?: (() => bigint) | undefined;
    /** Resolves the close amount again when the server refreshes the challenge. */
    resolveSignedCloseAmount?: ((challenge: TempoSessionChallenge) => string) | undefined;
    /** Final cumulative amount the client is willing to sign. */
    signedCloseAmount: string;
    /** Stores a fresh close challenge when the first close credential expired. */
    setChallenge?: ((challenge: TempoSessionChallenge) => void) | undefined;
    /** Channel/challenge pair being closed. */
    target: CloseTarget;
};
/** Returns true when a payment challenge is the built-in `tempo/session` method. */
export declare function isTempoSessionChallenge(challenge: Challenge.Challenge): challenge is TempoSessionChallenge;
/** Returns true when a challenge selects the TIP-1034 session protocol. */
export declare function isTip1034SessionChallenge(challenge: Challenge.Challenge): challenge is TempoSessionChallenge;
/** Reads a server-provided session snapshot from challenge method details. */
export declare function getSessionSnapshot(challenge: TempoSessionChallenge): SessionSnapshot | undefined;
/** Merges request headers and sets the payment authorization header for a retry. */
export declare function requestInitWithAuthorization(input: RequestInfo | URL, init: RequestInit | undefined, credential: string): RequestInit;
/** Returns the exact resource URL used for out-of-band management POSTs, without its fragment. */
export declare function managementInput(input: RequestInfo | URL): RequestInfo | URL;
/** Converts a WebSocket URL into the HTTP URL used for its payment challenge probe. */
export declare function webSocketProbeUrl(input: string | URL): URL;
/** Reads an HTTP problem detail body, falling back to raw text for non-problem responses. */
export declare function readProblemDetail(response: Response): Promise<string>;
/** Posts a top-up management credential and returns its receipt, when present. */
export declare function postTopUp(parameters: PostTopUpParameters): Promise<SessionReceipt | undefined>;
/** Retries an HTTP 402 when the server snapshot asks for more voucher headroom. */
export declare function retryHttpPaymentRequired(parameters: RetryHttpPaymentRequiredParameters): Promise<Response | undefined>;
/** Resolves whether a 402 response can be handled by an automatic session voucher retry. */
export declare function resolveRetryHttpPaymentContext(parameters: {
    channel: ChannelEntry | null;
    response: Response;
}): RetryHttpPaymentContext | undefined;
/** Posts a cooperative close credential over HTTP and returns its receipt, when present. */
export declare function closeHttpSession(parameters: CloseHttpSessionParameters): Promise<SessionReceipt | undefined>;
/** Options accepted by the auto-driving SSE session flow. */
export type SseDriverOptions = RequestInit & {
    /** Called for each payment receipt emitted by the SSE stream. */
    onReceipt?: ((receipt: SessionReceipt) => void) | undefined;
    /** Abort signal used to cancel the stream. */
    signal?: AbortSignal | undefined;
};
/** @internal Options used when consuming an already-paid SSE response. */
export type SseResponseOptions = {
    onReceipt?: ((receipt: SessionReceipt) => void) | undefined;
    signal?: AbortSignal | undefined;
};
/** Dependencies the SSE driver needs from `SessionManager`. */
export type OpenSseSessionParameters = {
    /** Creates a session credential for the selected challenge/context. */
    createSessionCredential(challenge: TempoSessionChallenge, context: SessionContext): Promise<string>;
    /** Paid fetch flow used for the initial SSE request and any retry. */
    doFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    /** Fetch implementation used for management voucher posts. */
    fetch: typeof globalThis.fetch;
    /** Returns the active channel, if any. */
    getChannel(): ChannelEntry | null;
    /** Returns the latest challenge observed by the manager. */
    getChallenge(): TempoSessionChallenge | null;
    /** Validates a cumulative amount against local client policy. */
    assertVoucherWithinLocalLimit(cumulativeAmount: bigint): void;
    /** Applies an incoming receipt to manager state. */
    acceptReceipt(receipt: SessionReceipt): void;
    /** Performs an automatic channel top-up when deposit is insufficient. */
    topUpIfNeeded(parameters: TopUpRequirement): Promise<void>;
};
/** Session payment operations shared with fetch-backed streams. */
export type SsePaymentDriver = Pick<OpenSseSessionParameters, 'assertVoucherWithinLocalLimit' | 'createSessionCredential' | 'fetch' | 'getChannel' | 'topUpIfNeeded'>;
/**
 * Opens an auto-driving paid SSE stream.
 *
 * The driver owns only transport parsing and management posts. Session state,
 * credential creation, and top-up policy stay in `SessionManager`.
 */
export declare function openSseSession(input: RequestInfo | URL, init: SseDriverOptions | undefined, driver: OpenSseSessionParameters): Promise<AsyncIterable<string>>;
/** @internal Consumes an already-paid SSE response with the session transport driver. */
export declare function consumeSseSessionResponse(input: RequestInfo | URL, response: Response, options: SseResponseOptions | undefined, driver: OpenSseSessionParameters): AsyncIterable<string>;
/** Application SSE frame emitted after session payment events are handled. */
export type SseResponseFrame = {
    /** Parsed application data, when present. */
    data?: string | undefined;
    /** Original frame text, including its separator. */
    raw: string;
};
/** Inputs for driving an open paid SSE response. */
export type DriveSseResponseParameters = {
    /** Handles a request for the stream's next cumulative voucher. */
    onNeedVoucher(event: NeedVoucherEvent): Promise<void>;
    /** Handles a payment receipt emitted by the stream. */
    onReceipt(receipt: SessionReceipt): void;
    /** Open SSE response to drive. */
    response: Response;
    /** Abort signal used to stop reading the response. */
    signal?: AbortSignal | undefined;
};
/** Handles session payment events and yields application SSE frames unchanged. */
export declare function driveSseResponse(parameters: DriveSseResponseParameters): AsyncGenerator<SseResponseFrame>;
/** Wraps an SSE response while handling session payment frames in-band. */
export declare function wrapSseResponse(parameters: DriveSseResponseParameters): Response;
/** Handles an in-band voucher request using the shared SSE payment driver. */
export declare function handleSseNeedVoucher(parameters: {
    challenge: TempoSessionChallenge | null;
    driver: SsePaymentDriver;
    input: RequestInfo | URL;
}, event: NeedVoucherEvent): Promise<void>;
/** Options accepted by the auto-driving WebSocket session flow. */
export type WebSocketDriverOptions = {
    /** Called for each payment receipt emitted by the WebSocket flow. */
    onReceipt?: ((receipt: SessionReceipt) => void) | undefined;
    /** WebSocket subprotocols passed to the runtime constructor. */
    protocols?: string | string[] | undefined;
    /** Abort signal used to cancel the socket payment flow. */
    signal?: AbortSignal | undefined;
};
/** Creates a session credential for a WebSocket payment challenge. */
export type CreateWebSocketCredential = (challenge: TempoSessionChallenge, context: SessionContext) => Promise<string>;
/** Inputs for probing and authorizing a paid WebSocket session. */
export type PrepareWebSocketSessionParameters = {
    /** Creates the opening session credential. */
    createSessionCredential: CreateWebSocketCredential;
    /** Fetch implementation used for the HTTP 402 probe. */
    fetch: typeof globalThis.fetch;
    /** WebSocket URL requested by the caller. */
    input: string | URL;
    /** Called after resolving the HTTP probe URL, before the network request. */
    onProbeUrl?: ((httpUrl: URL) => void) | undefined;
    /** Optional request init for the HTTP probe. */
    probeInit?: RequestInit | undefined;
    /** Optional abort signal applied to the HTTP probe. */
    signal?: AbortSignal | undefined;
};
/** Inputs for probing a paid WebSocket endpoint without creating a credential. */
export type ProbeWebSocketSessionParameters = Omit<PrepareWebSocketSessionParameters, 'createSessionCredential'>;
/** Result of resolving the current payment challenge for a WebSocket endpoint. */
export type ProbedWebSocketSession = Omit<PreparedWebSocketSession, 'credential'>;
/** Result of the HTTP probe and opening credential creation for a WebSocket session. */
export type PreparedWebSocketSession = {
    /** Selected tempo/session challenge from the HTTP probe. */
    challenge: TempoSessionChallenge;
    /** Opening authorization credential to send in-band after the socket opens. */
    credential: string;
    /** HTTP URL used for probe and out-of-band management requests. */
    httpUrl: URL;
    /** WebSocket URL to open. */
    wsUrl: URL;
};
/** Active WebSocket session bookkeeping shared by the manager and socket driver. */
export type ActiveSocketSession = {
    /** Challenge used to create credentials for this socket. */
    challenge: TempoSessionChallenge;
    /** Channel authorized by the opening credential. */
    channelId: Hex.Hex;
    /** Server close-ready receipt, when the stream is ready to close. */
    closeReadyReceipt: SessionReceipt | null;
    /** Number of application chunks delivered through the managed socket. */
    deliveredChunks: bigint;
    /** Expected final close amount while a close credential is in flight. */
    expectedCloseAmount: string | null;
    /** Raw socket while open; set to null after close. */
    socket: WebSocket | null;
    /** Raw token cost per delivered chunk. */
    tickCost: bigint;
};
/** Inputs for creating initial WebSocket payment runtime state. */
export type CreateActiveSocketSessionParameters = {
    /** Challenge selected by the HTTP probe. */
    challenge: TempoSessionChallenge;
    /** Opening credential sent when the socket opens. */
    credential: string;
    /** Raw runtime socket. */
    socket: WebSocket;
};
/** Dependencies the WebSocket driver needs from `SessionManager`. */
export type OpenWebSocketSessionParameters = {
    /** Challenge selected by the HTTP probe. */
    challenge: TempoSessionChallenge;
    /** Opening credential to send in-band after the socket opens. */
    credential: string;
    /** URL used for automatic top-up management calls. */
    httpUrl: URL;
    /** WebSocket constructor for the current runtime. */
    WebSocket: WebSocketConstructor;
    /** WebSocket URL to open. */
    wsUrl: URL;
    /** Optional WebSocket call options. */
    options?: WebSocketDriverOptions | undefined;
    /** Creates a session credential for the selected challenge/context. */
    createSessionCredential(challenge: TempoSessionChallenge, context: SessionContext): Promise<string>;
    /** Returns the active channel, if any. */
    getChannel(): ChannelEntry | null;
    /** Stores the active socket state in the manager. */
    setSocketSession(session: ActiveSocketSession): void;
    /** Fetches the route's current challenge after the active one expires. */
    refreshChallenge(): Promise<TempoSessionChallenge>;
    /** Validates a cumulative amount against local client policy. */
    assertVoucherWithinLocalLimit(cumulativeAmount: bigint): void;
    /** Applies an incoming receipt to manager state. */
    acceptReceipt(receipt: SessionReceipt): void;
    /** Rejects any pending close-ready wait. */
    rejectCloseReady(error: Error): void;
    /** Rejects any pending receipt wait. */
    rejectReceipt(error: Error): void;
    /** Records a close-ready receipt. */
    settleCloseReady(receipt: SessionReceipt): void;
    /** Records a payment receipt. */
    settleReceipt(receipt: SessionReceipt): void;
    /** Performs an automatic channel top-up when deposit is insufficient. */
    topUpIfNeeded(parameters: TopUpRequirement): Promise<void>;
    /** Waits for the opening receipt before returning the managed socket. */
    waitForReceipt(): Promise<SessionReceipt>;
};
/** Inputs for validating a receipt belongs to the active WebSocket payment flow. */
export type ExpectedSocketReceiptParameters = {
    /** Active WebSocket challenge ID. */
    challengeId: string;
    /** Active WebSocket channel ID. */
    channelId: Hex.Hex;
    /** Receipt received from a WebSocket payment frame. */
    receipt: SessionReceipt;
};
/** Inputs for validating a payment-close-ready frame. */
export type ValidateSocketCloseReadyReceiptParameters = ExpectedSocketReceiptParameters & {
    /** Local cumulative voucher authorization for the active channel. */
    cumulativeAmount: bigint;
};
/** Inputs for validating a payment-receipt frame. */
export type ValidateSocketPaymentReceiptParameters = ExpectedSocketReceiptParameters & {
    /** Expected final close amount while a close credential is in flight. */
    expectedCloseAmount: string | null;
};
/** Probes a WebSocket endpoint over HTTP and returns its current session challenge. */
export declare function probeWebSocketSession(parameters: ProbeWebSocketSessionParameters): Promise<ProbedWebSocketSession>;
/** Probes a WebSocket endpoint over HTTP and creates the opening credential. */
export declare function prepareWebSocketSession(parameters: PrepareWebSocketSessionParameters): Promise<PreparedWebSocketSession>;
/** Creates the initial runtime state for a paid WebSocket from its opening credential. */
export declare function createActiveSocketSession(parameters: CreateActiveSocketSessionParameters): ActiveSocketSession;
/** Returns whether a receipt belongs to the active WebSocket session. */
export declare function isExpectedSocketReceipt(parameters: ExpectedSocketReceiptParameters): boolean;
/** Returns a protocol failure message when a close-ready receipt is invalid. */
export declare function validateSocketCloseReadyReceipt(parameters: ValidateSocketCloseReadyReceiptParameters): string | undefined;
/** Returns a protocol failure message when a payment receipt is invalid. */
export declare function validateSocketPaymentReceipt(parameters: ValidateSocketPaymentReceiptParameters): string | undefined;
/**
 * Opens an auto-driving paid WebSocket session.
 *
 * The driver owns socket protocol frames. Session state, credential creation,
 * and top-up policy remain supplied by `SessionManager`.
 */
export declare function openWebSocketSession(parameters: OpenWebSocketSessionParameters): Promise<SessionManagedWebSocket>;
export {};
//# sourceMappingURL=Transports.d.ts.map