import type { Address, Hex } from 'viem';
import type * as Challenge from '../../../Challenge.js';
import type * as Store from '../../../Store.js';
import type * as Chain from '../precompile/Chain.js';
import type * as PrecompileChannel from '../precompile/Channel.js';
import type { SessionReceipt, SessionSignedVoucher } from '../precompile/Protocol.js';
import { type SignedVoucher } from '../precompile/Protocol.js';
import type { SessionMethodDetails } from './RequestState.js';
/**
 * State for an on-chain payment channel, including per-session accounting.
 *
 * Tracks the channel's identity, on-chain balance, the highest voucher
 * the server has accepted, and the current session's spend counters.
 * A channel is created when a payer opens an escrow on-chain and persists
 * until the channel is finalized (closed/settled).
 *
 * One channel = one session. The client owns the key and can't race with
 * itself, so concurrent session support is unnecessary.
 *
 * Monotonicity invariants (enforced by update callbacks):
 * - `highestVoucherAmount` only increases
 * - `settledOnChain` only increases
 * - `deposit` reflects the latest on-chain value
 */
export type State = BaseState & BackendState;
/** Result of an atomic channel deduction attempt. */
export type DeductResult = {
    ok: true;
    channel: State;
} | {
    ok: false;
    channel: State;
};
/** Persisted channel state after narrowing to the TIP-1034 precompile backend. */
export type StoredPrecompileChannel = BaseState & PrecompileBackendState;
/** On-chain state fields read from the TIP-1034 precompile. */
export type OnChainChannelState = {
    /** Current on-chain channel deposit. */
    deposit: bigint;
    /** Cumulative amount settled on-chain. */
    settled: bigint;
    /** Close-request timestamp, or zero when open. */
    closeRequestedAt: number | bigint;
};
/** Persisted fields that mirror authoritative on-chain channel state. */
export type ActiveOnChainStateFields = Pick<State, 'closeRequestedAt' | 'deposit' | 'settledOnChain'>;
/** Parameters for selecting the persisted highest accepted voucher. */
export type HighestVoucherParameters = {
    /** Channel ID used when constructing a new voucher record. */
    channelId: Hex;
    /** Existing persisted voucher amount and signature, when present. */
    current?: Pick<State, 'highestVoucher' | 'highestVoucherAmount'> | null | undefined;
    /** Candidate cumulative voucher amount. */
    cumulativeAmount: bigint;
    /** Candidate voucher signature. */
    signature: Hex;
};
/** Highest accepted voucher amount plus signed voucher payload. */
export type HighestVoucher = {
    /** Highest cumulative voucher amount to persist. */
    highestVoucherAmount: bigint;
    /** Signed voucher corresponding to `highestVoucherAmount`. */
    highestVoucher: SessionSignedVoucher | null;
};
/** Inputs for resolving the amount a close transaction should capture. */
export type ResolveCloseCaptureAmountParameters = {
    /** Close voucher cumulative amount. */
    cumulativeAmount: bigint;
    /** Current on-chain deposit. */
    onChainDeposit: bigint;
    /** Current on-chain settled amount. */
    onChainSettled: bigint;
    /** Locally recorded paid spend. */
    spent: bigint;
};
/** Inputs used when persisting or reconciling a successful open transaction. */
export type OpenChannelStateParameters = {
    /** Address stored as the effective voucher signer for this channel. */
    authorizedSigner: Address;
    /** Chain ID used by the opened channel. */
    chainId: number;
    /** Normalized channel ID. */
    channelId: Hex;
    /** Existing channel state, when one was already persisted. */
    current: State | null;
    /** Descriptor verified from the open transaction. */
    descriptor: PrecompileChannel.ChannelDescriptor;
    /** Escrow precompile address used by the channel. */
    escrow: Address;
    /** Transaction-bound expiring nonce hash from the open call. */
    expiringNonceHash: Hex;
    /** Initial or highest accepted cumulative voucher amount. */
    cumulativeAmount: bigint;
    /** Voucher signature for `cumulativeAmount`. */
    signature: Hex;
    /** Latest on-chain channel state read after open. */
    state: Chain.ChannelState;
};
/** Inputs for merging a successful top-up transaction into persisted channel state. */
export type TopUpStateParameters = {
    /** Existing channel state, when one is currently persisted. */
    current: State | null;
    /** Latest verified on-chain channel state read after top-up. */
    state: Chain.ChannelState;
};
/** Inputs for merging a newly accepted voucher with persisted channel state. */
export type AcceptVoucherStateUpdateParameters = {
    /** Latest on-chain channel state used to validate the voucher. */
    channelState: Chain.ChannelState;
    /** Existing channel state being updated. */
    current: State | null;
    /** Verified signed voucher. */
    voucher: SessionSignedVoucher;
};
/** Inputs for marking a channel as pending cooperative close. */
export type MarkPendingCloseParameters = {
    /** Timestamp used to mark the local pending-close state. */
    closeRequestedAt: bigint;
    /** Close voucher cumulative amount. */
    cumulativeAmount: bigint;
    /** Existing channel state being updated. */
    current: State | null;
    /** Current on-chain deposit. */
    onChainDeposit: bigint;
    /** Current on-chain settled amount. */
    onChainSettled: bigint;
};
/** Result of preparing local state for a cooperative close. */
export type PendingCloseUpdate = {
    /** Amount that should be captured on-chain at close. */
    captureAmount: bigint;
    /** Next local channel state, or null if no channel exists. */
    state: State | null;
};
/** Inputs for finalizing local state after a successful close transaction. */
export type FinalizeClosedChannelParameters = {
    /** Amount captured to payee during close. */
    captureAmount: bigint;
    /** Normalized channel ID. */
    channelId: Hex;
    /** Close voucher cumulative amount. */
    cumulativeAmount: bigint;
    /** Existing channel state being updated. */
    current: State | null;
    /** Close voucher signature. */
    signature: Hex;
};
/** Immutable channel identity fields derived from a verified TIP-1034 descriptor. */
export type PrecompileChannelIdentity = Pick<BaseState & PrecompileBackendState, 'authorizedSigner' | 'backend' | 'chainId' | 'channelId' | 'descriptor' | 'escrowContract' | 'expiringNonceHash' | 'operator' | 'payee' | 'payer' | 'salt' | 'token'>;
/** Inputs used to derive immutable persisted channel identity fields. */
export type ResolvePrecompileChannelIdentityParameters = {
    /** Address stored as the effective voucher signer for this channel. */
    authorizedSigner: Address;
    /** Chain ID used by the opened channel. */
    chainId: number;
    /** Normalized channel ID. */
    channelId: Hex;
    /** Descriptor verified from the open transaction. */
    descriptor: PrecompileChannel.ChannelDescriptor;
    /** Escrow precompile address used by the channel. */
    escrow: Address;
    /** Transaction-bound expiring nonce hash from the open call. */
    expiringNonceHash: Hex;
};
/** Inputs for reading a persisted precompile channel and validating its descriptor. */
export type LoadPrecompileChannelParameters = {
    /** Channel ID to read from the server store. */
    channelId: Hex;
    /** Chain ID used to rederive the channel descriptor. */
    chainId: number;
    /** Descriptor supplied by the credential payload. */
    descriptor: StoredPrecompileChannel['descriptor'];
    /** Escrow precompile address used to derive the channel ID. */
    escrow: Address;
    /** Server channel store. */
    store: ChannelStore;
    /** Whether to also validate descriptor identity against chain/payee/token fields. */
    validateDescriptor?: boolean | undefined;
};
/** Inputs for validating a signed voucher and merging it into channel state. */
export type VerifyAndAcceptVoucherParameters = {
    /** Credential challenge used to bind the returned receipt. */
    challenge: Challenge.Challenge;
    /** Persisted channel state before voucher acceptance. */
    channel: State;
    /** Latest on-chain state used as the deposit/settled authority. */
    channelState: Chain.ChannelState;
    /** Session method details used for voucher signature domain separation. */
    methodDetails: SessionMethodDetails;
    /** Minimum allowed voucher delta in raw units. */
    minVoucherDelta: bigint;
    /** Whether this presentation must advance the accepted voucher. */
    requireAdvance?: boolean | undefined;
    /** Server channel store. */
    store: ChannelStore;
    /** Signed cumulative voucher to verify and accept. */
    voucher: SignedVoucher;
};
/** Inputs for validating a cumulative voucher without recording it. */
export type ValidateVoucherParameters = Omit<VerifyAndAcceptVoucherParameters, 'challenge' | 'store'>;
/** Result of validating a cumulative voucher against persisted channel state. */
export type VoucherValidation = {
    /** Whether the voucher was already accepted at the same cumulative amount. */
    alreadyAccepted: boolean;
};
/** Channel backend-specific fields. */
export type BackendState = CompatibilityBackendState | PrecompileBackendState;
/** State for records owned by a backend outside the TIP-1034 precompile path. */
export interface CompatibilityBackendState {
    /** Optional backend marker for older stored records. */
    backend?: 'contract' | 'external' | undefined;
}
/** State for a TIP20EscrowChannel precompile-backed payment channel. */
export interface PrecompileBackendState {
    /** Channel backend. */
    backend: 'precompile';
    /** Descriptor used to derive the channel's identity. */
    descriptor: PrecompileChannel.ChannelDescriptor;
    /** Transaction-bound nonce hash used to derive the channel's identity. */
    expiringNonceHash: Hex;
    /** Address authorized to operate the channel. */
    operator: Address;
    /** Salt used to derive the channel's identity. */
    salt: Hex;
}
/** Common persisted state for every session channel backend. */
export interface BaseState {
    /** Address authorized to sign vouchers on behalf of the payer. */
    authorizedSigner: Address;
    /** Chain ID the channel was opened on. */
    chainId: number;
    /** Escrow contract address the channel was opened on. */
    escrowContract: Address;
    /** Unique identifier for this payment channel. */
    channelId: Hex;
    /** On-chain timestamp when a force-close was requested (0n if not requested). */
    closeRequestedAt: bigint;
    /** ISO 8601 timestamp when the channel was created. */
    createdAt: string;
    /** Current on-chain deposit in the escrow contract. */
    deposit: bigint;
    /** Whether the channel has been finalized (closed) on-chain. */
    finalized: boolean;
    /** The signed voucher corresponding to `highestVoucherAmount`. */
    highestVoucher: SessionSignedVoucher | null;
    /** Highest cumulative voucher amount accepted by the server. */
    highestVoucherAmount: bigint;
    /** Address of the payment recipient. */
    payee: Address;
    /** Address of the payment sender. */
    payer: Address;
    /** Cumulative amount settled on-chain so far. */
    settledOnChain: bigint;
    /** Cumulative amount spent (charged) against this channel's current session. */
    spent: bigint;
    /** Token contract address used for payments. */
    token: Address;
    /** Number of charge operations (API requests) fulfilled in the current session. */
    units: number;
    /** ISO 8601 timestamp of the last server-scheduled settlement. */
    lastSettlementAt?: string | undefined;
    /** Cumulative spent value when the last server-scheduled settlement ran. */
    lastSettlementSpent?: bigint | undefined;
    /** Charge operation count when the last server-scheduled settlement ran. */
    lastSettlementUnits?: number | undefined;
}
/** Returns whether a channel is backed by the TIP20EscrowChannel precompile. */
export declare function isPrecompileState(state: State): state is BaseState & PrecompileBackendState;
/** Returns the greater bigint value without decreasing persisted monotonic state. */
export declare function keepGreater(current: bigint, next: bigint): bigint;
/** Returns the greater close-request timestamp as a bigint. */
export declare function keepGreaterTimestamp(current: bigint, next: number | bigint): bigint;
/** Keeps local active-channel state in sync with authoritative on-chain reads. */
export declare function mergeActiveOnChainState(current: Partial<ActiveOnChainStateFields> | null | undefined, state: OnChainChannelState): ActiveOnChainStateFields;
/** Keeps the existing higher voucher, otherwise stores the supplied candidate voucher. */
export declare function resolveHighestVoucher(parameters: HighestVoucherParameters): HighestVoucher;
/** Derives persisted identity fields from a verified precompile channel descriptor. */
export declare function resolvePrecompileChannelIdentity(parameters: ResolvePrecompileChannelIdentityParameters): PrecompileChannelIdentity;
/** Builds the persisted state for a verified precompile channel open. */
export declare function openChannelState(parameters: OpenChannelStateParameters): State;
/** Merges top-up on-chain state into persisted channel state without decreasing monotonic fields. */
export declare function topUpChannelState(parameters: TopUpStateParameters): State | null;
/** Merges an accepted voucher into persisted channel state after signature and on-chain checks pass. */
export declare function acceptVoucherStateUpdate(parameters: AcceptVoucherStateUpdateParameters): State;
/**
 * Resolves the close capture amount and validates it is covered by both the
 * close voucher and current on-chain deposit.
 */
export declare function resolveCloseCaptureAmount(parameters: ResolveCloseCaptureAmountParameters): bigint;
/** Marks local channel state as pending close and returns the bounded capture amount. */
export declare function markPendingClose(parameters: MarkPendingCloseParameters): PendingCloseUpdate;
/** Finalizes local channel state after a successful close transaction. */
export declare function finalizeClosedChannelState(parameters: FinalizeClosedChannelParameters): State | null;
/** Loads a precompile-backed channel or throws a verification error. */
export declare function loadPrecompileChannel(parameters: LoadPrecompileChannelParameters): Promise<StoredPrecompileChannel>;
/** Verifies a cumulative voucher without changing persisted channel state. */
export declare function validateVoucher(parameters: ValidateVoucherParameters): Promise<VoucherValidation>;
/** Verifies a cumulative voucher and returns a session receipt after store reconciliation. */
export declare function verifyAndAcceptVoucher(parameters: VerifyAndAcceptVoucherParameters): Promise<SessionReceipt>;
/**
 * Internal store interface for channel state persistence.
 *
 * ## Atomicity contract
 *
 * The `updateChannel` method uses an atomic read-modify-write callback.
 * The callback receives the current state (or `null` if none exists), and
 * returns the next state (or `null` to delete). Implementations must
 * guarantee that no concurrent mutation occurs between reading `current`
 * and writing the return value.
 *
 * Callbacks should be synchronous and deterministic. When a `ChannelStore`
 * is backed by `Store.update()`, adapters may retry them internally.
 *
 * Backends implement this via their native mechanisms:
 * - **In-memory / JS single-thread**: Synchronous callback execution
 * - **Durable Objects**: Single-threaded execution model
 * - **D1 / SQL**: Database transactions
 */
export type ChannelStore = {
    getChannel(channelId: Hex): Promise<State | null>;
    /**
     * Atomic read-modify-write for channel state.
     * Return `null` from `fn` to delete the channel.
     */
    updateChannel(channelId: Hex, fn: (current: State | null) => State | null): Promise<State | null>;
    /**
     * Wait for the next update to a channel.
     *
     * Returns a `Promise` that resolves once `updateChannel` is called for
     * `channelId`. Implementations should resolve immediately if the channel
     * was updated between the call to `waitForUpdate` and the `Promise`
     * being awaited.
     *
     * When not implemented, callers fall back to polling.
     */
    waitForUpdate?(channelId: Hex): Promise<void>;
    /**
     * Atomic read-modify-write that returns the callback's `result` directly.
     *
     * Used by {@link deductFromChannel} to atomically compute the deduction
     * outcome. When backed by `Store.update()`, this delegates to the store's
     * native atomic primitive.
     */
    updateChannelResult?<result>(channelId: Hex, fn: (current: State | null) => Store.Change<State, result>): Promise<result>;
};
/** Normalizes and validates 32-byte channel IDs before store lookup or persistence. */
export declare function normalizeChannelId(channelId: string): Hex;
/** Wraps a generic mppx store in the shared session channel-store interface. */
export declare function fromStore(store: Store.Store | Store.AtomicStore): ChannelStore;
/**
 * Atomically deducts `amount` from a channel's available voucher balance.
 *
 * Returns `{ ok: true, channel }` with updated spend/unit counters when the
 * deduction succeeds. Returns `{ ok: false, channel }` without mutating state
 * when the channel exists but cannot currently be charged.
 */
export declare function deductFromChannel(store: ChannelStore, channelId: State['channelId'], amount: bigint): Promise<DeductResult>;
//# sourceMappingURL=ChannelStore.d.ts.map