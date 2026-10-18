import { type Hex } from 'viem';
import type { ChannelDescriptor, NeedVoucherEvent, RawAmountString, SessionCredentialPayload, SessionReceipt } from '../precompile/Protocol.js';
import type { SessionSnapshot } from '../Snapshot.js';
import type { ChannelEntry } from './ChannelOps.js';
import type { SessionContext } from './CredentialState.js';
import type { TempoSessionChallenge } from './Transports.js';
import type { ActiveSocketSession } from './Transports.js';
export { deserializeSnapshot, serializeSnapshot } from '../Snapshot.js';
export type { SessionSnapshot } from '../Snapshot.js';
/** Initial manager state before a session challenge is observed. */
export type IdleSessionState = {
    status: 'idle';
};
/** State after a tempo/session challenge has been selected but before a credential is created. */
export type ChallengedSessionState = {
    status: 'challenged';
    challengeId: string;
};
/** State while a server snapshot is being used to hydrate a reusable channel. */
export type HydratingSessionState = {
    status: 'hydrating';
    challengeId: string;
    snapshot: SessionSnapshot;
};
/** State while the client is creating or submitting an opening channel credential. */
export type OpeningSessionState = {
    status: 'opening';
    challengeId: string;
};
/** Active state variant used after a channel is opened, hydrated, or receives a receipt. */
export type ActiveSessionState = {
    status: 'active';
    challengeId: string;
    channelId: Hex;
    descriptor: ChannelDescriptor;
    /** Highest cumulative voucher amount accepted by the server. */
    acceptedCumulative: RawAmountString;
    /** Current channel deposit ceiling, tracked independently from accepted cumulative spend. */
    deposit: RawAmountString;
    /** Amount actually consumed by delivered work/content. */
    spent: RawAmountString;
    /** Paid units delivered by the server. */
    units: number;
};
/** State when the server needs a larger cumulative voucher but no top-up is needed. */
export type VoucherNeededSessionState = {
    status: 'voucherNeeded';
    challengeId: string;
    channelId: Hex;
    descriptor: ChannelDescriptor;
    requiredCumulative: RawAmountString;
    deposit: RawAmountString;
};
/** State when the server-required cumulative amount exceeds current channel deposit. */
export type ToppingUpSessionState = {
    status: 'toppingUp';
    challengeId: string;
    channelId: Hex;
    descriptor: ChannelDescriptor;
    deposit: RawAmountString;
};
/** State while the server is settling accepted voucher spend on-chain. */
export type SettlingSessionState = {
    status: 'settling';
    channelId: Hex;
    descriptor: ChannelDescriptor;
    deposit: RawAmountString;
};
/** State after unilateral close has been requested and withdrawal is not yet available. */
export type CloseRequestedSessionState = {
    status: 'closeRequested';
    channelId: Hex;
    descriptor: ChannelDescriptor;
};
/** State after the unilateral close delay has elapsed and funds can be withdrawn. */
export type WithdrawableSessionState = {
    status: 'withdrawable';
    channelId: Hex;
    descriptor: ChannelDescriptor;
};
/** State while a cooperative close credential or close transaction is in flight. */
export type ClosingSessionState = {
    status: 'closing';
    channelId: Hex;
    descriptor: ChannelDescriptor;
};
/** Terminal state after channel close finalization. */
export type ClosedSessionState = {
    status: 'closed';
    channelId: Hex;
    descriptor: ChannelDescriptor;
};
/** Pure state-machine state for a TIP-1034 session. */
export type SessionState = IdleSessionState | ChallengedSessionState | HydratingSessionState | OpeningSessionState | ActiveSessionState | VoucherNeededSessionState | ToppingUpSessionState | SettlingSessionState | CloseRequestedSessionState | WithdrawableSessionState | ClosingSessionState | ClosedSessionState;
/** Data required to construct active session state. */
export type CreateActiveStateParameters = Omit<ActiveSessionState, 'status'>;
/** State variants that can follow a need-voucher event. */
export type NeedVoucherSessionState = VoucherNeededSessionState | ToppingUpSessionState;
/** Events accepted by the pure session reducer. */
export type SessionEvent = {
    type: 'challengeReceived';
    challengeId: string;
} | {
    type: 'challenge';
    challengeId: string;
    snapshot?: SessionSnapshot | undefined;
} | {
    type: 'activated';
    challengeId: string;
    entry: ChannelEntry;
    spent: RawAmountString;
    units?: number | undefined;
} | {
    type: 'opened';
    receipt: SessionReceipt;
    descriptor: ChannelDescriptor;
    deposit: RawAmountString;
} | {
    type: 'hydrated';
    snapshot: SessionSnapshot;
} | {
    type: 'receiptAccepted';
    receipt: SessionReceipt;
    entry: ChannelEntry;
} | {
    type: 'needVoucher';
    event: NeedVoucherEvent;
    descriptor: ChannelDescriptor;
} | {
    type: 'topUpStarted';
} | {
    type: 'voucherAccepted';
    receipt: SessionReceipt;
    deposit?: string | undefined;
} | {
    type: 'settleStarted';
} | {
    type: 'settled';
    receipt: SessionReceipt;
    deposit?: string | undefined;
} | {
    type: 'closeRequested';
} | {
    type: 'withdrawable';
} | {
    type: 'closeStarted';
} | {
    type: 'closed';
    receipt?: SessionReceipt | undefined;
};
/** IO work requested by the pure reducer. */
export type SessionEffect = {
    type: 'hydrate';
    snapshot: SessionSnapshot;
} | {
    type: 'open';
} | {
    type: 'topUp';
    channelId: Hex;
    amount: string;
} | {
    type: 'voucher';
    payload?: SessionCredentialPayload | undefined;
} | {
    type: 'settle';
    channelId: Hex;
} | {
    type: 'requestClose';
    channelId: Hex;
} | {
    type: 'withdraw';
    channelId: Hex;
} | {
    type: 'close';
    channelId: Hex;
};
/** Effects emitted by need-voucher transition planning. */
export type NeedVoucherSessionEffect = Extract<SessionEffect, {
    type: 'topUp';
}> | Extract<SessionEffect, {
    type: 'voucher';
}>;
/** Inputs for deciding whether a need-voucher event needs a voucher or deposit top-up first. */
export type ResolveNeedVoucherTransitionParameters = {
    /** Current challenge ID retained by the active session state. */
    challengeId: string;
    /** Descriptor for the channel requiring more authorization. */
    descriptor: ChannelDescriptor;
    /** Server event describing required cumulative authorization and current deposit. */
    event: NeedVoucherEvent;
};
/** Result of the need-voucher transition decision. */
export type NeedVoucherTransition = {
    /** Next machine state. */
    state: NeedVoucherSessionState;
    /** Driver effects required to satisfy the server request. */
    effects: NeedVoucherSessionEffect[];
};
/** Return value for every pure state-machine transition. */
export type SessionTransition = {
    /** State after applying the event. */
    state: SessionState;
    /** Declarative IO requested from the transport/precompile driver. */
    effects: SessionEffect[];
};
/** Initial state for a TIP-1034 session state machine. */
export declare const initialState: {
    status: "idle";
};
/** Constructs the canonical active state shape for the reducer and transport drivers. */
export declare function createActiveState(parameters: CreateActiveStateParameters): ActiveSessionState;
/** Applies a state-machine event and returns the next state plus requested effects. */
export declare function reduce(state: SessionState, event: SessionEvent): SessionTransition;
/** Applies a reducer event to mutable manager runtime state. */
export declare function dispatchSessionEvent(runtime: Pick<SessionManagerRuntime, 'state'>, event: SessionEvent): SessionTransition;
/** Decides whether a need-voucher event can be answered by voucher or requires top-up first. */
export declare function resolveNeedVoucherTransition(parameters: ResolveNeedVoucherTransitionParameters): NeedVoucherTransition;
/** Inputs for validating a cumulative authorization against the local client cap. */
export type LocalVoucherLimitParameters = {
    /** Cumulative amount being authorized or accepted. */
    cumulativeAmount: bigint;
    /** Optional maximum local authorization boundary. Null means uncapped. */
    maxVoucherCumulative: bigint | null;
};
/** Inputs for validating a payment receipt against local client state. */
export type LocalReceiptValidationParameters = {
    /** Active local channel cache entry. */
    channel: ChannelEntry | null;
    /** Optional local authorization cap. Null means uncapped. */
    maxVoucherCumulative: bigint | null;
    /** Receipt returned by the server. */
    receipt: SessionReceipt;
};
/** Inputs for deriving the next locally observed spend from a receipt. */
export type NextReceiptSpendParameters = {
    /** Active local channel cache entry. */
    channel: ChannelEntry | null;
    /** Optional local authorization cap. Null means uncapped. */
    maxVoucherCumulative: bigint | null;
    /** Receipt returned by the server, when present. */
    receipt: SessionReceipt | null | undefined;
    /** Current locally observed spend. */
    spent: bigint;
};
/** Inputs for resolving the initial channel deposit in automatic client mode. */
export type ResolveOpeningDepositParameters = {
    /** Caller-provided raw deposit override. */
    contextDepositRaw?: string | undefined;
    /** Optional local maximum cumulative deposit/authorization boundary. */
    maxDeposit?: bigint | undefined;
    /** Current request amount in raw token units. */
    requestAmount: bigint;
    /** Server-suggested opening deposit in raw token units. */
    suggestedDepositRaw?: string | undefined;
};
/** Throws when a cumulative voucher amount exceeds the caller's local cap. */
export declare function assertVoucherWithinLocalLimit(parameters: LocalVoucherLimitParameters): void;
/** Validates a server receipt without allowing it to increase the local signing boundary. */
export declare function assertReceiptWithinLocalState(parameters: LocalReceiptValidationParameters): void;
/** Returns the monotonic next local spend after validating an optional receipt. */
export declare function nextSpentFromReceipt(parameters: NextReceiptSpendParameters): bigint;
/** Parses a manager amount. Bigints are raw units; strings are parsed using token decimals. */
export declare function parseManagerAmount(amount: string | bigint, decimals: number): bigint;
/** Resolves the opening deposit from explicit context, server hint, request amount, and local cap. */
export declare function resolveOpeningDeposit(parameters: ResolveOpeningDepositParameters): bigint;
/** Resolves a bounded automatic refill, preferring explicit policy over server headroom. */
export declare function resolveAutomaticTopUp(parameters: {
    deposit: bigint;
    maxDeposit?: bigint | null | undefined;
    requiredCumulative: bigint;
    suggestedDeposit?: bigint | undefined;
    topUpAmount?: bigint | null | undefined;
}): bigint;
/** Enforces the optional client-side maximum cumulative voucher authorization. */
export declare function assertWithinMaxDeposit(cumulativeAmount: bigint, maxDeposit: bigint | undefined): void;
/** Predicate used when waiting for a specific session receipt. */
export type SessionReceiptPredicate = (receipt: SessionReceipt) => boolean;
/** Resolved data required to close a locally active session channel. */
export type CloseTarget = {
    /** Challenge used to bind the close credential. */
    challenge: TempoSessionChallenge;
    /** Local channel cache entry being closed. */
    channel: ChannelEntry;
    /** Channel ID being closed. */
    channelId: Hex;
};
/** Inputs for choosing the active close target. */
export type ResolveCloseTargetParameters = {
    /** Current active channel cache entry. */
    channel: ChannelEntry | null;
    /** Active WebSocket session, when close is happening in-band. */
    currentSocket: ActiveSocketSession | null;
    /** Last HTTP/SSE challenge observed by the manager. */
    lastChallenge: TempoSessionChallenge | null;
};
/** Inputs for validating socket close-ready spend before signing the final close voucher. */
export type CloseReadySpendParameters = {
    /** Local cumulative voucher authorization. */
    cumulativeAmount: bigint;
    /** Spend reported by the close-ready receipt. */
    readySpent: bigint;
    /** Latest receipt-tracked local spend. */
    spent: bigint;
};
/** Inputs for matching the expected final close receipt. */
export type ExpectedCloseReceiptParameters = {
    /** Challenge ID used for the close credential. */
    challengeId: string;
    /** Channel ID being closed. */
    channelId: Hex;
    /** Expected final cumulative authorization. */
    expectedCloseAmount: string;
    /** Lowest cumulative spend already confirmed by the client. */
    minimumSpent?: bigint | undefined;
    /** Receipt to test. */
    receipt: SessionReceipt;
};
/** Resolves the currently closeable channel and challenge, or undefined when no channel is open. */
export declare function resolveCloseTarget(parameters: ResolveCloseTargetParameters): CloseTarget | undefined;
/** Highest spend the client may sign for during close based on local receipts and vouchers. */
export declare function localCloseSpendLimit(parameters: Omit<CloseReadySpendParameters, 'readySpent'>): bigint;
/** Throws when a close-ready receipt asks the client to sign beyond local state. */
export declare function assertCloseReadyWithinLocalState(parameters: CloseReadySpendParameters): void;
/** Returns whether a receipt is the expected final close settlement receipt. */
export declare function isExpectedCloseReceipt(parameters: ExpectedCloseReceiptParameters): boolean;
/** Parameters used to project cached client channel data into an active machine state. */
export type ActiveStateFromChannelParameters = {
    /** Challenge ID associated with the active payment flow. */
    challengeId: string;
    /** Cached channel entry that owns descriptor, deposit, and cumulative authorization. */
    entry: ChannelEntry;
    /** Latest locally observed spend in raw units. */
    spent: string;
    /** Paid units observed by the active flow. */
    units: number;
};
/** Parameters used to project a closed channel into machine state. */
export type ClosedStateFromChannelParameters = {
    /** Channel ID that has been closed. */
    channelId: Hex;
    /** Cached channel entry that owns the descriptor. */
    entry: ChannelEntry;
};
/** Inputs for computing the safest fallback close amount when no fresh close-ready receipt is available. */
export type FallbackCloseAmountParameters = {
    /** Challenge ID being closed. */
    challengeId: string;
    /** Channel ID being closed. */
    channelId: Hex;
    /** Last socket close-ready receipt, when one was received. */
    closeReadyReceipt?: SessionReceipt | null | undefined;
    /** Current local cumulative voucher authorization. */
    cumulativeAmount: bigint;
    /** Number of application chunks delivered over the socket. */
    deliveredChunks?: bigint | undefined;
    /** Current socket challenge ID, used to decide whether socket delivery data applies. */
    socketChallengeId?: string | undefined;
    /** Current socket channel ID, used to decide whether socket delivery data applies. */
    socketChannelId?: Hex | undefined;
    /** Latest locally observed spend from receipts. */
    spent: bigint;
    /** Per-message socket charge in raw units. */
    tickCost?: bigint | undefined;
};
/** Minimal mutable session runtime state that must be restored when an auto-drive attempt fails. */
export type RuntimeState = {
    /** Current client channel cache entry, when one is active. */
    channel: ChannelEntry | null;
    /** Latest locally observed spend from receipts. */
    spent: bigint;
    /** Current public state-machine state. */
    state: SessionState;
};
/** Mutable client runtime state owned by one auto-driving `sessionManager()` instance. */
export type SessionManagerRuntime = RuntimeState & {
    /** Last Tempo session challenge observed by HTTP/SSE/WebSocket bootstrap. */
    lastChallenge: TempoSessionChallenge | null;
    /** Last HTTP resource URL usable for management POSTs. */
    lastUrl: RequestInfo | URL | null;
    /** Active WebSocket payment session bookkeeping, when a socket is open. */
    socketSession: ActiveSocketSession | null;
};
/** Immutable snapshot of mutable runtime fields needed for rollback. */
export type RuntimeSnapshot = {
    /** Channel fields mutated during optimistic open/top-up/voucher attempts. */
    channel: {
        cumulativeAmount: bigint;
        deposit: bigint;
        entry: ChannelEntry;
        opened: boolean;
    } | null;
    /** Latest locally observed spend when the snapshot was taken. */
    spent: bigint;
    /** State-machine state when the snapshot was taken. */
    state: SessionState;
};
/** Inputs for applying a server receipt to manager-local runtime state. */
export type ApplySessionReceiptToRuntimeParameters = {
    /** Optional local cumulative authorization cap. Null means uncapped. */
    maxVoucherCumulative: bigint | null;
    /** Receipt returned by a server transport, when present. */
    receipt: SessionReceipt | null | undefined;
    /** Mutable manager runtime state to update. */
    runtime: SessionManagerRuntime;
};
/** Inputs for restoring local cumulative authorization after a failed optimistic voucher retry. */
export type RestoreCumulativeAuthorizationParameters = {
    /** Active local channel entry, when one is available. */
    channel: ChannelEntry | null;
    /** Channel ID whose optimistic cumulative amount should be restored. */
    channelId: Hex;
    /** Previous cumulative voucher authorization in raw units. */
    cumulativeAmount: bigint;
    /** Last challenge ID observed by the manager, when known. */
    challengeId?: string | undefined;
    /** Latest locally observed spend in raw units. */
    spent: bigint;
    /** Current public state-machine state, used to preserve active unit count. */
    state: SessionState;
};
/** Projects cached channel data into an active state-machine state. */
export declare function activeStateFromChannel(parameters: ActiveStateFromChannelParameters): SessionState;
/** Creates the initial mutable runtime state for an auto-driving session manager. */
export declare function createSessionManagerRuntime(): SessionManagerRuntime;
/** Validates a receipt, advances observed spend, and projects matching receipts into public state. */
export declare function applySessionReceiptToRuntime(parameters: ApplySessionReceiptToRuntimeParameters): void;
/** Projects a verified receipt plus local descriptor/deposit data into an active state-machine state. */
export declare function activeStateFromReceipt(receipt: SessionReceipt, entry: ChannelEntry): SessionState;
/** Projects a closed channel into the public closed state-machine state. */
export declare function closedStateFromChannel(parameters: ClosedStateFromChannelParameters): SessionState;
/** Projects a final close receipt into the public closed state-machine state. */
export declare function closedStateFromReceipt(receipt: SessionReceipt, entry: ChannelEntry): SessionState;
/**
 * Computes the fallback close amount without authorizing more than the local cumulative voucher.
 *
 * Priority:
 * 1. Matching close-ready receipt spend.
 * 2. Matching socket delivery estimate (`deliveredChunks * tickCost`) clamped by cumulative.
 * 3. Local cumulative authorization high-water mark for HTTP/SSE.
 */
export declare function computeFallbackCloseAmount(parameters: FallbackCloseAmountParameters): bigint;
/**
 * Restores a channel's cumulative voucher boundary and returns the refreshed active state.
 *
 * Returns `undefined` when the active channel does not match or no challenge is
 * available to label the active state.
 */
export declare function restoreCumulativeAuthorization(parameters: RestoreCumulativeAuthorizationParameters): ActiveSessionState | undefined;
/** Captures mutable session runtime fields before an optimistic manager action. */
export declare function captureRuntimeSnapshot(runtime: RuntimeState): RuntimeSnapshot;
/** Restores mutable session runtime fields from a previous snapshot. */
export declare function restoreRuntimeSnapshot(snapshot: RuntimeSnapshot, currentChannel: ChannelEntry | null): RuntimeState;
/** Creates a session credential for the selected challenge/context. */
export type CreateSocketCloseCredential = (challenge: TempoSessionChallenge, context: SessionContext) => Promise<string>;
/** Inputs for cooperatively closing an active WebSocket session in-band. */
export type CloseSocketSessionParameters = {
    /** Raw WebSocket used by the active paid stream. */
    activeSocket: WebSocket;
    /** Creates the signed close credential. */
    createSessionCredential: CreateSocketCloseCredential;
    /** Active WebSocket session state. */
    currentSocket: ActiveSocketSession;
    /** Latest locally tracked spend from receipts. */
    spent: bigint;
    /** Channel/challenge pair being closed. */
    target: CloseTarget;
    /** Waits for the server's close-ready receipt after requesting stream close. */
    waitForCloseReady(): Promise<SessionReceipt>;
    /** Waits for the final settlement receipt matching `predicate`. */
    waitForReceipt(predicate: SessionReceiptPredicate): Promise<SessionReceipt>;
};
/** Cooperatively closes an active paid WebSocket session and returns the final receipt. */
export declare function closeSocketSession(parameters: CloseSocketSessionParameters): Promise<SessionReceipt>;
//# sourceMappingURL=Runtime.d.ts.map