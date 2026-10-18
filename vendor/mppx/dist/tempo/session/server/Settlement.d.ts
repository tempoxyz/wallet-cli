import { type Account as viem_Account, type Address, type Hex } from 'viem';
import type * as Credential from '../../../Credential.js';
import type { MaybePromise } from '../../../internal/types.js';
import type * as Method from '../../../Method.js';
import * as Store from '../../../Store.js';
import type * as FeePayer from '../../internal/fee-payer.js';
import * as Chain from '../precompile/Chain.js';
import { type SessionCredentialPayload, type SessionReceipt } from '../precompile/Protocol.js';
import * as ChannelStore from './ChannelStore.js';
/** Fee-payer parameter accepted by the server session method. */
export type ParameterFeePayer = viem_Account | string | true | undefined;
/** Resolved fee-payer mode for credential-time transaction submission. */
export type ResolvedFeePayer = viem_Account | true | undefined;
/** Minimum method details needed to decide credential-time fee sponsorship. */
export type CredentialFeePayerMethodDetails = {
    /** Whether the challenge advertised fee-payer support. */
    feePayer?: boolean | undefined;
};
/** Inputs used to resolve request-time fee sponsorship policy. */
export type ResolveRequestFeePayerParameters = {
    /** Incoming credential, present for verification/management requests. */
    credential: Credential.Credential | null | undefined;
    /** Default fee-payer account resolved from server parameters. */
    defaultFeePayer?: viem_Account | undefined;
    /** Server-level fee-payer parameter. */
    parameterFeePayer?: ParameterFeePayer;
    /** Per-request fee-payer override. */
    requestFeePayer?: boolean | viem_Account | undefined;
};
/** Inputs used to resolve credential-time fee sponsorship account. */
export type ResolveCredentialFeePayerParameters = {
    /** Request object being verified. */
    request: unknown;
    /** Challenge method details echoed by the credential. */
    methodDetails: CredentialFeePayerMethodDetails;
    /** Configured local fee payer, hosted relay URL, or sponsorship flag. */
    feePayer?: ParameterFeePayer;
};
/** Fee-payer value read from an untrusted credential challenge request. */
export type RequestFeePayerValue = boolean | viem_Account | undefined;
/** Reads the optional `feePayer` field from an untrusted request object. */
export declare function readRequestFeePayer(value: unknown): RequestFeePayerValue;
/** Resolves whether a challenge should advertise fee sponsorship or a credential can use it. */
export declare function resolveRequestFeePayer(parameters: ResolveRequestFeePayerParameters): boolean | viem_Account | undefined;
/** Resolves the fee-payer account allowed for an incoming credential. */
export declare function resolveCredentialFeePayer(parameters: ResolveCredentialFeePayerParameters): ResolvedFeePayer;
/** Declarative server-side settlement cadence for automatic session settlement. */
export type SettlementSchedule = {
    /** Settle after this many additional paid units since the previous scheduled settlement. */
    units?: number | undefined;
    /** Settle after this much additional settlement amount since the previous scheduled settlement. */
    amount?: string | bigint | undefined;
    /** Settle after this many milliseconds since the previous scheduled settlement. */
    intervalMs?: number | undefined;
};
/** Settlement schedule normalized into raw token units. */
export type ResolvedSettlementSchedule = {
    /** Raw token amount threshold. */
    amount?: bigint | undefined;
    /** Elapsed-time threshold since previous settlement. */
    intervalMs?: number | undefined;
    /** Paid unit threshold. */
    units?: number | undefined;
};
/** Progress counters compared against a server-owned settlement schedule. */
export type SettlementProgress = {
    /** Additional raw spend since the previous scheduled settlement boundary. */
    amount: bigint;
    /** Milliseconds elapsed since the previous scheduled settlement boundary. */
    elapsedMs?: number | undefined;
    /** Additional paid units since the previous scheduled settlement boundary. */
    units: number;
};
/** Context emitted when an on-chain settlement or close transaction is confirmed. */
export type SessionSettlementContext = Readonly<{
    /** On-chain transaction hash (or signature on Solana). */
    txHash: Hex;
    /** Channel ID that was settled. */
    channelId: Hex;
    /** The trigger that caused settlement. */
    trigger: 'settle' | 'close' | 'scheduled';
    /** Cumulative amount settled on-chain to the payee (raw token units). */
    amount: bigint;
    /** Incremental amount settled in this transaction (raw token units). */
    delta: bigint;
}>;
/** Callback invoked after an on-chain settlement or close transaction is confirmed. */
export type OnSessionSettlement = (context: SessionSettlementContext) => MaybePromise<void>;
/** Inputs used to mark a channel after automatic scheduled settlement succeeds. */
export type MarkSettlementCompleteParameters = {
    channelId: ChannelStore.State['channelId'];
    settledAt?: string | undefined;
    store: ChannelStore.ChannelStore;
};
/** Converts a public settlement schedule into raw-unit thresholds. */
export declare function resolveSettlementSchedule(schedule: SettlementSchedule | undefined, decimals: number): ResolvedSettlementSchedule | undefined;
/**
 * Computes the schedule progress for an unsettled precompile-backed channel.
 *
 * Returns `undefined` for channels that cannot be scheduled: non-precompile
 * records, channels without an accepted voucher, or channels with no unsettled
 * voucher amount.
 */
export declare function resolveSettlementProgress(channel: ChannelStore.State): SettlementProgress | undefined;
/** Returns whether the precompile channel has crossed any configured settlement threshold. */
export declare function isSettlementDue(channel: ChannelStore.State, schedule: ResolvedSettlementSchedule | undefined): boolean;
/** Records the channel spend/unit counters that a scheduled settlement captured. */
export declare function markSettlementComplete(parameters: MarkSettlementCompleteParameters): Promise<void>;
/** Callback used by post-verification accounting to deduct spend from a channel. */
export type ChargeSessionChannel = (channelId: Hex, amount: bigint) => Promise<ChannelStore.State>;
/** Callback used by post-verification accounting to run server-owned settlement policy. */
export type SettleChargedSessionChannel = (channel: ChannelStore.State) => Promise<Hex | undefined>;
/** Inputs for charging a precompile-backed session channel. */
export type ChargeParameters = {
    /** Server-side channel store. */
    store: ChannelStore.ChannelStore;
    /** Channel ID to deduct from. */
    channelId: Hex;
    /** Raw token amount to charge. */
    amount: bigint;
};
/** Inputs used to apply default HTTP request/response accounting after credential verification. */
export type ApplyVerifiedHttpAccountingParameters = {
    /** Captured request metadata from the verified envelope, when this is a request-backed flow. */
    capturedRequest?: Method.CapturedRequest | undefined;
    /** Deducts the configured request amount from channel spend. */
    charge: ChargeSessionChannel;
    /** Returns the raw request amount to deduct for one content response. Called only when charging. */
    getRequestAmount: () => bigint;
    /** Credential action that produced the receipt. Only open/voucher can pay for content. */
    payloadAction: SessionCredentialPayload['action'];
    /** Receipt returned by credential verification before content accounting. */
    receipt: SessionReceipt;
    /** Marks an SSE receipt whose first content unit was charged during verification. */
    markPrepaidReceipt?: ((receipt: SessionReceipt) => SessionReceipt) | undefined;
    /** Whether SSE transport is enabled. SSE accounting is stream-driven, not HTTP-response-driven. */
    sseEnabled: boolean;
    /** Runs optional server settlement policy after a successful content charge. */
    settleCharged: SettleChargedSessionChannel;
};
/** Returns whether an accepted credential will authorize and charge an HTTP content response. */
export declare function shouldApplyVerifiedHttpAccounting(parameters: Pick<ApplyVerifiedHttpAccountingParameters, 'capturedRequest' | 'payloadAction' | 'sseEnabled'>): boolean;
/** Applies the default HTTP content charge after a session credential has been accepted. */
export declare function applyVerifiedHttpAccounting(parameters: ApplyVerifiedHttpAccountingParameters): Promise<SessionReceipt>;
/** Atomically deducts spend from a channel and maps store failures to typed session errors. */
export declare function chargeSessionChannel(parameters: ChargeParameters): Promise<ChannelStore.State>;
/** Store accepted by public settlement controls. */
export type SessionStoreInput = Store.Store | ChannelStore.ChannelStore;
/** Inputs used to validate who may submit payee-side settlement transactions. */
export type SettlementSenderParameters = {
    channelId: Hex;
    operation: 'close' | 'settle';
    operator: Address;
    payee: Address;
    sender: Address | undefined;
};
/** Options for server-driven precompile settlement transactions. */
export type SettlementTransactionOptions = {
    /** Account used to send the settlement transaction. Defaults to the viem client account. */
    account?: viem_Account | undefined;
    /** Candidate fee tokens for sponsored settlement. Defaults to the channel token. */
    candidateFeeTokens?: readonly Address[] | undefined;
    /** TIP20EscrowChannel precompile address override. */
    escrowContract?: Address | undefined;
    /** Fee-payer account, or `true` when the client transport uses a configured hosted fee-payer service. */
    feePayer?: viem_Account | true | undefined;
    /** Optional policy for sponsored settlement. */
    feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
    /** Optional fee token override for settlement. */
    feeToken?: Address | undefined;
    /** Callback invoked after the settlement transaction is confirmed. */
    onSessionSettlement?: OnSessionSettlement | undefined;
};
/** Inputs for applying a server-owned automatic settlement schedule. */
export type MaybeSettleScheduledParameters = {
    /** Account used to send the settlement transaction. */
    account?: viem_Account | undefined;
    /** Channel that was just charged. */
    channel: ChannelStore.State;
    /** viem client used to settle on-chain. */
    client: Chain.TransactionClient;
    /** Fee-payer account, or `true` when the client transport uses a configured hosted fee-payer service. */
    feePayer?: viem_Account | true | undefined;
    /** Optional policy for sponsored settlement. */
    feePayerPolicy?: Partial<FeePayer.Policy> | undefined;
    /** Optional fee token override for settlement. */
    feeToken?: Address | undefined;
    /** Callback invoked after the scheduled settlement transaction is confirmed. */
    onSessionSettlement?: OnSessionSettlement | undefined;
    /** Resolved server-owned settlement cadence. */
    schedule: ResolvedSettlementSchedule | undefined;
    /** Server-side channel store. */
    store: ChannelStore.ChannelStore;
};
/** Resolves either a generic mppx store or an already-wrapped channel store. */
export declare function resolveChannelStore(store: SessionStoreInput): ChannelStore.ChannelStore;
/** Returns the account attached to a viem client, when one exists. */
export declare function getClientAccount(client: {
    account?: viem_Account | undefined;
}): viem_Account | undefined;
/** Validates that the transaction sender is the channel payee or nonzero operator. */
export declare function assertSettlementSender(parameters: SettlementSenderParameters): void;
/** Applies automatic settlement when the server-owned schedule is due. */
export declare function maybeSettleScheduled(parameters: MaybeSettleScheduledParameters): Promise<Hex | undefined>;
/** Settles the highest accepted voucher for a precompile-backed session channel. */
export declare function settle(store_: SessionStoreInput, client: Chain.TransactionClient, channelId_: Hex, options?: SettlementTransactionOptions): Promise<Hex>;
/** Settles multiple precompile-backed session channels with the same validation as {@link settle}. */
export declare function settleBatch(store: SessionStoreInput, client: Chain.TransactionClient, channelIds: readonly Hex[], options?: SettlementTransactionOptions): Promise<Hex[]>;
//# sourceMappingURL=Settlement.d.ts.map