import type { Address, Hex } from 'viem';
import type * as Challenge from '../../../Challenge.js';
/** Amount encoded by TIP20EscrowChannel as a `uint96` on-chain value. */
export type Uint96 = bigint;
/** Decimal string containing raw token units, before applying token decimals. */
export type RawAmountString = string;
/** Returns whether a bigint can be encoded as a TIP20EscrowChannel `uint96` amount. */
export declare function isUint96(value: bigint): value is Uint96;
/** Parses an unsigned decimal raw amount when it fits TIP-1034's `uint96` range. */
export declare function parseUint96Amount(value: RawAmountString): Uint96 | undefined;
/** Converts a bigint into a TIP20EscrowChannel `uint96` amount after validating bounds. */
export declare function uint96(value: bigint): Uint96;
/** Asserts that a bigint can be encoded as a TIP20EscrowChannel `uint96` amount. */
export declare function assertUint96(value: bigint): void;
/** Full TIP-1034 channel descriptor used to derive and verify a channel ID. */
export type ChannelDescriptor = {
    /** Wallet that funds the channel and authorizes voucher spend. */
    payer: Address;
    /** Wallet that receives settlement from the channel. */
    payee: Address;
    /** Optional payee-side operator authorized for channel operations; zero address means unset. */
    operator: Address;
    /** TIP-20 token escrowed by the channel. */
    token: Address;
    /** Payer-selected entropy that makes otherwise identical descriptors unique. */
    salt: Hex;
    /** Address authorized to sign vouchers; zero address delegates to `payer`. */
    authorizedSigner: Address;
    /** Hash of the signed expiring-nonce open transaction required by TIP-1034. */
    expiringNonceHash: Hex;
};
/** Public descriptor for a TIP-1034 session channel. */
export type SessionDescriptor = ChannelDescriptor;
/**
 * Voucher for cumulative payment.
 * Cumulative monotonicity prevents replay attacks.
 */
export type Voucher = {
    channelId: Hex;
    cumulativeAmount: bigint;
};
/**
 * Signed voucher with EIP-712 signature.
 */
export type SignedVoucher = Voucher & {
    signature: Hex;
};
/**
 * Credential payload that opens a TIP-1034 precompile channel and authorizes initial spend.
 */
export type OpenCredentialPayload = {
    action: 'open';
    type: 'transaction';
    /** TIP-1034 channel ID derived from descriptor, escrow, and chain ID. */
    channelId: Hex;
    /** Signed Tempo transaction containing the precompile `open` call. */
    transaction: Hex;
    /** Voucher signature for `cumulativeAmount`. */
    signature: Hex;
    /** Descriptor needed to recover and verify the channel. */
    descriptor: ChannelDescriptor;
    /** Initial cumulative spend authorized by the opening voucher, as raw units. */
    cumulativeAmount: RawAmountString;
    /** Voucher signer selected for the opened channel. */
    authorizedSigner?: Address | undefined;
};
/**
 * Credential payload that adds deposit to an existing TIP-1034 precompile channel.
 */
export type TopUpCredentialPayload = {
    action: 'topUp';
    type: 'transaction';
    /** TIP-1034 channel ID being topped up. */
    channelId: Hex;
    /** Signed Tempo transaction containing the precompile `topUp` call. */
    transaction: Hex;
    /** Descriptor for the channel being topped up. */
    descriptor: ChannelDescriptor;
    /** Additional deposit to add, as raw units. */
    additionalDeposit: RawAmountString;
};
/**
 * Credential payload that increases cumulative spend authorization.
 */
export type VoucherCredentialPayload = {
    action: 'voucher';
    /** TIP-1034 channel ID the voucher applies to. */
    channelId: Hex;
    /** Descriptor for the voucher's channel. */
    descriptor: ChannelDescriptor;
    /** Highest cumulative spend authorized by this voucher, as raw units. */
    cumulativeAmount: RawAmountString;
    /** Voucher signature for `cumulativeAmount`. */
    signature: Hex;
};
/**
 * Credential payload that cooperatively closes a channel at final cumulative spend.
 */
export type CloseCredentialPayload = {
    action: 'close';
    /** TIP-1034 channel ID being closed. */
    channelId: Hex;
    /** Descriptor for the channel being closed. */
    descriptor: ChannelDescriptor;
    /** Final cumulative spend authorized at close, as raw units. */
    cumulativeAmount: RawAmountString;
    /** Voucher signature for `cumulativeAmount`. */
    signature: Hex;
};
/**
 * TIP20EscrowChannel precompile session credential payload (discriminated union).
 */
export type SessionCredentialPayload = OpenCredentialPayload | TopUpCredentialPayload | VoucherCredentialPayload | CloseCredentialPayload;
/**
 * Backend-neutral voucher for cumulative payment.
 * Cumulative monotonicity prevents replay attacks.
 */
export interface SessionVoucher {
    channelId: Hex;
    cumulativeAmount: bigint;
}
/**
 * Backend-neutral signed voucher with EIP-712 signature.
 */
export interface SessionSignedVoucher extends SessionVoucher {
    signature: Hex;
}
/**
 * Management action names shared by session credential payloads.
 */
export type SessionCredentialAction = 'open' | 'topUp' | 'voucher' | 'close';
/**
 * Minimal credential shape shared by transport helpers that only need routing context.
 */
export type SessionCredentialContext = {
    /** Session channel ID referenced by the authorization payload. */
    channelId: Hex;
    /** Session management action when the payload is a management credential. */
    action?: SessionCredentialAction | undefined;
};
/** Returns whether a value is a supported session credential action. */
export declare function isSessionCredentialAction(value: unknown): value is SessionCredentialAction;
/** Returns whether a value has the session credential fields needed by transports. */
export declare function isSessionCredentialContext(value: unknown): value is SessionCredentialContext;
/** Reads the shared session credential context or throws the provided error message. */
export declare function requireSessionCredentialContext(value: unknown, errorMessage?: string): SessionCredentialContext;
/** Reads the raw per-unit session amount from a payment challenge. */
export declare function readSessionChallengeAmount(challenge: Challenge.Challenge): bigint;
/**
 * SSE event emitted when session balance is exhausted mid-stream.
 * The client responds by sending a new voucher credential.
 *
 * Per spec §11.6, the event data contains:
 * - `channelId` — channel identifier
 * - `requiredCumulative` — minimum cumulative amount the next voucher must authorize
 * - `acceptedCumulative` — current highest accepted voucher amount
 * - `deposit` — current on-chain deposit ceiling; when `requiredCumulative > deposit`
 *   the client must top up the channel before sending a new voucher
 */
export interface NeedVoucherEvent {
    channelId: Hex;
    /** Minimum cumulative voucher amount required to continue, as raw token units. */
    requiredCumulative: RawAmountString;
    /** Highest cumulative voucher amount currently accepted by the server, as raw token units. */
    acceptedCumulative: RawAmountString;
    /** Current channel deposit ceiling, as raw token units. */
    deposit: RawAmountString;
}
/** Returns whether a value is a typed need-voucher event payload. */
export declare function isNeedVoucherEvent(value: unknown): value is NeedVoucherEvent;
/**
 * Session receipt returned in Payment-Receipt header.
 */
export interface SessionReceipt {
    /** Payment method that produced the receipt. */
    method: 'tempo';
    /** Payment intent that produced the receipt. */
    intent: 'session';
    /** Receipt status. */
    status: 'success';
    /** ISO timestamp when the receipt was created. */
    timestamp: string;
    /** Payment reference (channelId). Satisfies Receipt.Receipt contract. */
    reference: string;
    /** Challenge ID that this receipt settles or acknowledges. */
    challengeId: string;
    /** TIP-1034 channel ID. */
    channelId: Hex;
    /** Highest cumulative voucher amount accepted by the server, as raw token units. */
    acceptedCumulative: RawAmountString;
    /** Amount actually consumed by delivered work/content, as raw token units. */
    spent: RawAmountString;
    /** Paid units delivered by the server, when the transport reports them. */
    units?: number | undefined;
    /** On-chain transaction hash when this receipt came from settlement or close. */
    txHash?: Hex | undefined;
}
/** Returns whether a value is a typed session payment receipt. */
export declare function isSessionReceipt(value: unknown): value is SessionReceipt;
/**
 * Create a session receipt.
 */
export declare function createSessionReceipt(params: {
    challengeId: string;
    channelId: Hex;
    acceptedCumulative: bigint;
    spent: bigint;
    units?: number | undefined;
    txHash?: Hex | undefined;
}): SessionReceipt;
/**
 * Serialize a session receipt to the Payment-Receipt header format.
 */
export declare function serializeSessionReceipt(receipt: SessionReceipt): string;
/**
 * Deserialize a Payment-Receipt header value to a session receipt.
 */
export declare function deserializeSessionReceipt(encoded: string): SessionReceipt;
/**
 * Parsed SSE event (discriminated union by `type`).
 */
export type SseEvent = {
    type: 'message';
    data: string;
} | {
    type: 'payment-need-voucher';
    data: NeedVoucherEvent;
} | {
    type: 'payment-receipt';
    data: SessionReceipt;
};
/** Returns whether a response carries an SSE event stream. */
export declare function isEventStream(response: Response): boolean;
/**
 * Format a session receipt as a Server-Sent Event.
 *
 * Produces a valid SSE event string with `event: payment-receipt`
 * and the receipt JSON as the `data` field.
 */
export declare function formatReceiptEvent(receipt: SessionReceipt): string;
/**
 * Format a need-voucher event as a Server-Sent Event.
 *
 * Emitted when the channel balance is exhausted mid-stream.
 */
export declare function formatNeedVoucherEvent(params: NeedVoucherEvent): string;
/**
 * Format an application message as SSE, preserving embedded newlines.
 *
 * SSE requires multi-line payloads to be emitted as separate `data:` fields.
 */
export declare function formatMessageEvent(value: string): string;
/**
 * Parse a raw SSE event string into a typed event.
 *
 * Unknown event names fall back to `message`, which preserves compatibility
 * with generic SSE producers.
 */
export declare function parseEvent(raw: string): SseEvent | null;
/** Extracts the `data:` field value from a single SSE event block. */
export declare function extractData(event: string): string | null;
/** In-band WebSocket payment protocol frame. */
export type Message = {
    mpp: 'authorization';
    authorization: string;
} | {
    mpp: 'message';
    data: string;
} | {
    mpp: 'payment-close-request';
} | {
    mpp: 'payment-close-ready';
    data: SessionReceipt;
} | {
    mpp: 'payment-error';
    status: number;
    message: string;
} | {
    mpp: 'payment-need-voucher';
    data: NeedVoucherEvent;
} | {
    mpp: 'payment-receipt';
    data: SessionReceipt;
};
/** Input for formatting a WebSocket payment protocol error frame. */
export type ErrorMessageParameters = {
    /** Human-readable error message. */
    message: string;
    /** HTTP-style payment error status. */
    status: number;
};
/** Formats the initial or follow-up payment authorization frame. */
export declare function formatAuthorizationMessage(authorization: string): string;
/** Formats an application payload frame. */
export declare function formatApplicationMessage(data: string): string;
/** Formats the client request for a final close-ready receipt. */
export declare function formatCloseRequestMessage(): string;
/** Formats the server close-ready receipt frame. */
export declare function formatCloseReadyMessage(receipt: SessionReceipt): string;
/** Formats a server request for a larger voucher. */
export declare function formatNeedVoucherMessage(params: NeedVoucherEvent): string;
/** Formats an intermediate or final payment receipt frame. */
export declare function formatReceiptMessage(receipt: SessionReceipt): string;
/** Formats a payment protocol error frame. */
export declare function formatErrorMessage(parameters: ErrorMessageParameters): string;
/** Parses a WebSocket payment protocol frame, returning null for application data. */
export declare function parseMessage(raw: string): Message | null;
/** Canonical TIP-1034 TIP-20 Channel Escrow precompile address. */
export declare const tip20ChannelEscrow = "0x4d50500000000000000000000000000000000000";
//# sourceMappingURL=Protocol.d.ts.map