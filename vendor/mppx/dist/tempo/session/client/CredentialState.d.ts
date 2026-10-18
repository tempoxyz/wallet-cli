import { type Account as ViemAccount, type Address, type Client, type Hex } from 'viem';
import type * as Challenge from '../../../Challenge.js';
import * as Account from '../../../viem/Account.js';
import * as z from '../../../zod.js';
import * as AutoSwap from '../../internal/auto-swap.js';
import * as Chain from '../precompile/Chain.js';
import * as Channel from '../precompile/Channel.js';
import type { SessionCredentialPayload } from '../precompile/Protocol.js';
import type { SessionSnapshot } from '../Snapshot.js';
import { type ChannelEntry } from './ChannelOps.js';
import { type ChannelSink } from './ChannelStore.js';
/** Credential payload variants that carry cumulative voucher authorization. */
export type CumulativeCredentialPayload = Extract<SessionCredentialPayload, {
    cumulativeAmount: string;
}>;
/** Returns whether a credential payload carries cumulative voucher authorization. */
export declare function hasCredentialCumulativeAmount(payload: SessionCredentialPayload): payload is CumulativeCredentialPayload;
/** Reads cumulative authorization from a credential payload when the action carries one. */
export declare function readCredentialCumulativeAmount(payload: SessionCredentialPayload): bigint | undefined;
/** Runtime schema for low-level TIP-1034 session credential context. */
export declare const sessionContextSchema: z.ZodMiniObject<{
    account: z.ZodMiniOptional<z.ZodMiniCustom<`0x${string}` | Account.Account | undefined, `0x${string}` | Account.Account | undefined>>;
    autoSwap: z.ZodMiniOptional<z.ZodMiniCustom<AutoSwap.resolve.Value, AutoSwap.resolve.Value>>;
    action: z.ZodMiniOptional<z.ZodMiniEnum<{
        close: "close";
        open: "open";
        topUp: "topUp";
        voucher: "voucher";
    }>>;
    channelId: z.ZodMiniOptional<z.ZodMiniCustom<`0x${string}`, `0x${string}`>>;
    cumulativeAmount: z.ZodMiniOptional<z.ZodMiniString<string>>;
    cumulativeAmountRaw: z.ZodMiniOptional<z.ZodMiniString<string>>;
    transaction: z.ZodMiniOptional<z.ZodMiniCustom<`0x${string}`, `0x${string}`>>;
    descriptor: z.ZodMiniOptional<z.ZodMiniCustom<Channel.ChannelDescriptor, Channel.ChannelDescriptor>>;
    additionalDeposit: z.ZodMiniOptional<z.ZodMiniString<string>>;
    additionalDepositRaw: z.ZodMiniOptional<z.ZodMiniString<string>>;
    depositRaw: z.ZodMiniOptional<z.ZodMiniString<string>>;
}, z.core.$strip>;
/** Low-level context accepted by `tempo.session()` for manual credentials. */
export type SessionContext = {
    /** Optional account override used for this credential only. */
    account?: Account.getResolver.Parameters['account'] | undefined;
    /** Automatically acquire the session currency from fallback stablecoins before open/top-up. */
    autoSwap?: AutoSwap.resolve.Value | undefined;
    /** Manual credential action. Omit for automatic open/recover/voucher management. */
    action?: 'open' | 'topUp' | 'voucher' | 'close' | undefined;
    /** Channel ID being reused or manually operated on. */
    channelId?: Hex | undefined;
    /** Human-readable cumulative voucher authorization, parsed with configured decimals. */
    cumulativeAmount?: string | undefined;
    /** Raw cumulative voucher authorization. Takes precedence over `cumulativeAmount`. */
    cumulativeAmountRaw?: string | undefined;
    /** Signed Tempo transaction for manual open/top-up credentials. */
    transaction?: Hex | undefined;
    /** TIP-1034 descriptor required for recovery and manual credentials. */
    descriptor?: Channel.ChannelDescriptor | undefined;
    /** Human-readable additional top-up deposit, parsed with configured decimals. */
    additionalDeposit?: string | undefined;
    /** Raw additional top-up deposit. Takes precedence over `additionalDeposit`. */
    additionalDepositRaw?: string | undefined;
    /** Raw opening deposit override for automatic open credentials. */
    depositRaw?: string | undefined;
};
/** Manual low-level TIP-1034 session action name. */
export type SessionAction = NonNullable<SessionContext['action']>;
/** Context amount fields that may be supplied as human-readable or raw token units. */
export type SessionAmountField = 'additionalDeposit' | 'cumulativeAmount';
/** Session context narrowed to an explicit manual action. */
export type ManualSessionContext = SessionContext & {
    action: SessionAction;
};
/** Manual session action context after the required channel descriptor is present. */
export type ManualSessionDescriptorContext = ManualSessionContext & {
    /** TIP-1034 channel descriptor used by manual open/top-up/voucher/close actions. */
    descriptor: Channel.ChannelDescriptor;
};
/** Session context narrowed to a recoverable TIP-1034 channel descriptor. */
export type DescriptorSessionContext = SessionContext & {
    descriptor: Channel.ChannelDescriptor;
};
/** Returns whether a session context contains an explicit manual action. */
export declare function hasSessionAction(context: SessionContext | undefined): context is ManualSessionContext;
/** Returns whether a context is a manual action with the descriptor required to execute it. */
export declare function hasManualSessionDescriptor(context: SessionContext | undefined): context is ManualSessionDescriptorContext;
/** Returns whether a session context contains a recoverable channel descriptor. */
export declare function hasSessionDescriptor(context: SessionContext | undefined): context is DescriptorSessionContext;
/** Parses an optional session context amount, preferring the raw-unit field when present. */
export declare function parseOptionalContextAmount(context: SessionContext, decimals: number, field: SessionAmountField): bigint | undefined;
/** Parses a required session context amount and throws with action-specific context when absent. */
export declare function requireContextAmount(context: SessionContext, decimals: number, field: SessionAmountField, action: string): bigint;
/** Tempo-specific details embedded in a `tempo/session` challenge request. */
export type ClientSessionMethodDetails = {
    /** Chain ID used for voucher domain and channel ID derivation. */
    chainId?: number | undefined;
    /** Escrow contract address advertised by the server. */
    escrowContract?: Address | undefined;
    /** Legacy escrow hint accepted during migration. */
    escrow?: Address | undefined;
    /** Whether the challenge allows fee-sponsored open/top-up transactions. */
    feePayer?: boolean | undefined;
    /** Fee token selected by the server for open/top-up transactions. */
    feeToken?: Address | undefined;
    /** Channel operator address advertised by the server. */
    operator?: Address | undefined;
    /** Server bootstrap snapshot for a reusable session channel. */
    sessionSnapshot?: SessionSnapshot | undefined;
};
/** Dependencies used to resolve a challenge into typed credential-planning data. */
export type ResolveChallengeContextParameters = {
    /** Whether to accept a noncanonical escrow advertised by the server. @default false */
    allowCustomEscrow?: boolean | undefined;
    /** Challenge received from the 402 response. */
    challenge: Challenge.Challenge;
    /** Optional local escrow override. */
    escrowOverride?: Address | undefined;
    /** Permitted payment chains, checked before resolution when known and again before signing. */
    allowedChainIds?: readonly number[] | undefined;
    /** Resolves the viem client for the challenge chain. */
    getClient(parameters: {
        chainId?: number | undefined;
    }): Client | Promise<Client>;
};
/** Reads TIP-1034 channel state for a recovery candidate. */
export type ReadReusableChannelState = (client: Client, channelId: Hex, escrow: Address) => Promise<Chain.ChannelState>;
/** Expected request fields used to prove a descriptor belongs to the current challenge. */
export type ReusableChannelExpectation = {
    /** Chain ID used in the TIP-1034 channel ID derivation. */
    chainId: number;
    /** Escrow precompile address used in the TIP-1034 channel ID derivation. */
    escrow: Address;
    /** Payee expected by the current challenge. */
    payee: Address;
    /** Payer address controlled by the local account. */
    payer: Address;
    /** Voucher authority resolved from the local account. */
    authorizedSigner: Address;
    /** Token expected by the current challenge. */
    token: Address;
};
/** Inputs for validating and loading an existing precompile session channel. */
export type ResolveReusableChannelParameters = {
    /** Optional caller/server supplied channel ID. Must match the descriptor-derived ID. */
    channelId?: string | undefined;
    /** Viem client used to read on-chain channel state. */
    client: Client;
    /** Descriptor required by TIP-1034 vouchers and management transactions. */
    descriptor: Channel.ChannelDescriptor;
    /** Expected challenge fields the descriptor must match. */
    expected: ReusableChannelExpectation;
    /** Optional state reader for tests or custom clients. Defaults to `Chain.getChannelState`. */
    readChannelState?: ReadReusableChannelState | undefined;
};
/** Validated reusable channel data. */
export type ReusableChannel = {
    /** Descriptor-derived TIP-1034 channel ID. */
    channelId: Hex;
    /** On-chain channel state proving the channel is open and reusable. */
    state: Chain.ChannelState;
};
/** Resolved payment challenge fields used to plan a client-side session credential. */
export type ChallengeContext = {
    amount: bigint;
    challenge: Challenge.Challenge;
    chainId: number;
    client: Client;
    escrow: Address;
    feePayer?: boolean | undefined;
    feeToken?: Address | undefined;
    key: string;
    operator?: Address | undefined;
    payee: Address;
    snapshot?: SessionSnapshot | undefined;
    /** Server-provided raw deposit hint for opening a channel, before local maxDeposit capping. */
    suggestedDepositRaw?: string | undefined;
    token: Address;
};
/** Inputs used to choose the next client-side session credential operation. */
export type PlanCredentialParameters = {
    account: ViemAccount;
    /** Channel previously stored for this challenge scope, fetched by the caller. */
    entry: ChannelEntry | undefined;
    context?: SessionContext | undefined;
    decimals: number;
    maxDeposit?: bigint | undefined;
    resolved: ChallengeContext;
};
/** Inputs used to derive reusable-channel recovery context from caller context and server hints. */
export type ResolveRecoverContextParameters = {
    /** Caller-provided low-level session context, when present. */
    context?: SessionContext | undefined;
    /** Server-provided session snapshot, when present. */
    snapshot?: SessionSnapshot | undefined;
};
/** Inputs used to choose the next cumulative authorization for a recovered channel. */
export type ResolveRecoveredCumulativeParameters = {
    /** Caller or stored-channel recovery context. */
    context: DescriptorSessionContext;
    /** Token decimals used to parse human-readable context amounts. */
    decimals: number;
    /** Current request amount from the active challenge. */
    requestAmount: bigint;
    /** Server snapshot for the recovered channel, when present. */
    snapshot?: SessionSnapshot | undefined;
    /** On-chain settled amount used when no local/server accounting is available. */
    settled: bigint;
};
/** Inputs used to validate and hydrate a server-provided session snapshot. */
export type HydrateSessionSnapshotParameters = {
    /** Account expected to own the channel and its voucher authority. */
    account: ViemAccount;
    /** Viem client used to read authoritative TIP-1034 channel state. */
    client: Client;
    /** Snapshot returned by an MPP server bootstrap. */
    snapshot: SessionSnapshot;
    /** Optional state reader for deterministic tests. */
    readChannelState?: ReadReusableChannelState | undefined;
};
/** Validated client channel state reconstructed without local persistence. */
export type HydratedSessionSnapshot = {
    /** Reusable channel entry safe to cache locally. */
    entry: ChannelEntry;
    /** Server-accounted delivered spend at bootstrap time. */
    spent: bigint;
};
/** Data-first description of the next credential operation the client should execute. */
export type CredentialPlan = 
/** No reusable channel is available, so create an open transaction and initial voucher. */
{
    type: 'open';
    account: ViemAccount;
    context?: SessionContext | undefined;
    maxDeposit?: bigint | undefined;
    resolved: ChallengeContext;
}
/** Rehydrate a known channel from server snapshot or caller descriptor before signing. */
 | {
    type: 'recover';
    account: ViemAccount;
    context: DescriptorSessionContext;
    decimals: number;
    maxDeposit?: bigint | undefined;
    resolved: ChallengeContext;
}
/** Reuse an active cached channel by increasing the cumulative voucher amount. */
 | {
    type: 'voucher';
    account: ViemAccount;
    entry: ChannelEntry;
    maxDeposit?: bigint | undefined;
    resolved: ChallengeContext;
}
/** Caller supplied an explicit low-level action such as top-up, voucher, or close. */
 | {
    type: 'manual';
    account: ViemAccount;
    context: ManualSessionDescriptorContext;
    decimals: number;
    resolved: ChallengeContext;
};
/** Resolves raw challenge fields into the typed data required by client credential planning. */
export declare function resolveChallengeContext(parameters: ResolveChallengeContextParameters): Promise<ChallengeContext>;
/** Validates descriptor identity and reads open channel state for client-side recovery. */
export declare function resolveReusableChannel(parameters: ResolveReusableChannelParameters): Promise<ReusableChannel>;
/** Resolves descriptor-based recovery data, preferring caller context over server hints. */
export declare function resolveRecoverContext(parameters: ResolveRecoverContextParameters): DescriptorSessionContext | undefined;
/** Resolves a voucher boundary that can satisfy the resumed request. */
export declare function resolveRecoveredCumulative(parameters: ResolveRecoveredCumulativeParameters): bigint;
/** Checks a server snapshot against its signed voucher and current TIP-1034 state. */
export declare function hydrateSessionSnapshot(parameters: HydrateSessionSnapshotParameters): Promise<HydratedSessionSnapshot>;
/** Returns whether `account` can satisfy the descriptor's voucher authority. */
export declare function canSignDescriptor(account: ViemAccount, descriptor: Channel.ChannelDescriptor): boolean;
/** Chooses the next credential plan from local channel cache and optional caller context. */
export declare function planCredential(parameters: PlanCredentialParameters): CredentialPlan;
/** Executes a credential plan and returns the concrete session credential payload. */
export declare function executeCredentialPlan(plan: CredentialPlan, sink: ChannelSink, autoSwap?: AutoSwap.resolve.Resolved | false): Promise<SessionCredentialPayload>;
//# sourceMappingURL=CredentialState.d.ts.map