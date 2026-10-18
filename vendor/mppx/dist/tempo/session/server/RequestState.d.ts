import { type Account as viem_Account, type Address, type Hex } from 'viem';
import * as Constants from '../../../Constants.js';
import type * as Credential from '../../../Credential.js';
import type { Challenge } from '../../../index.js';
import type * as z from '../../../zod.js';
import * as Methods from '../../Methods.js';
import { isSessionContentRequest, type RequestBodyProbe } from '../../server/internal/request-body.js';
import type * as PrecompileChain from '../precompile/Chain.js';
import { type SessionCredentialPayload } from '../precompile/Protocol.js';
import type { SessionSnapshot } from '../Snapshot.js';
import * as ChannelStore from './ChannelStore.js';
import { type ParameterFeePayer, type ResolvedFeePayer } from './Settlement.js';
/** Inputs used to build server bootstrap hints for a reusable session channel. */
export type ResolveSessionSnapshotParameters = {
    /** Raw request amount that must be covered by the next voucher. */
    amount: bigint;
    /** Channel ID from credential or challenge request, when available. */
    channelId: Hex | undefined;
    /** Payment fields the reusable channel must match before it is advertised. */
    expected?: SessionSnapshotPaymentFields | undefined;
    /** Minimum raw-unit increase required when the next voucher must advance. */
    minimumVoucherAdvance?: bigint | undefined;
    /** Whether the next voucher must advance beyond the accepted cumulative amount. */
    requireVoucherAdvance?: boolean | undefined;
    /** Server channel store. */
    store: ChannelStore.ChannelStore;
};
/** Payment fields used to bind a reusable channel hint to the current challenge. */
export type SessionSnapshotPaymentFields = {
    /** Tempo chain ID expected by the challenge. */
    chainId: number;
    /** Token address expected by the challenge. */
    currency: Address;
    /** Escrow precompile address expected by the challenge. */
    escrowContract: Address;
    /** Payee address expected by the challenge. */
    recipient: Address;
};
/** Request metadata available to `resolveChannelId` without exposing a mutable `Request`. */
export type SessionChannelIdRequest = {
    /** Request headers, useful for cookies or auth/session headers. */
    readonly headers: Headers;
    /** Whether the original request had a body, when known. */
    readonly hasBody?: boolean | undefined;
    /** HTTP method for the protected request. */
    readonly method: string;
    /** Request URL, when the transport captured it. */
    readonly url?: URL | undefined;
};
/** Inputs for resolving a reusable channel when the request did not include a channel ID. */
export type ResolveSessionChannelIdParameters = {
    /** Captured HTTP request metadata, when the transport provides it. */
    request?: SessionChannelIdRequest | undefined;
    /** Credential submitted with the request, when present. */
    credential: Credential.Credential | null | undefined;
    /** Cryptographic payer identity from a verified zero-amount bootstrap proof. */
    source?: string | undefined;
    /** Session payment request being challenged. */
    paymentRequest: SessionPaymentRequestInput;
    /** Channel store backing this session method. */
    store: ChannelStore.ChannelStore;
};
/**
 * Application-owned lookup from authenticated identity and payment scope to an existing session
 * channel. MPPx does not derive a storage key or scan the channel store; the returned channel ID is
 * loaded and independently validated before its snapshot is advertised.
 */
export type ResolveSessionChannelId = (parameters: ResolveSessionChannelIdParameters) => Promise<string | null | undefined> | string | null | undefined;
/** Normalizes a session channel ID hint when one is present. */
export declare function normalizeSessionChannelId(value: unknown): Hex | undefined;
/** Extracts and normalizes a credential channel ID after credential verification. */
export declare function getCredentialChannelId(credential: Credential.Credential | null | undefined): `0x${string}` | undefined;
/** Resolves the channel ID used to build server-side session bootstrap hints. */
export declare function resolveSessionChannelId(parameters: {
    capturedRequest?: RequestBodyProbe | undefined;
    credential: Credential.Credential | null | undefined;
    request: SessionPaymentRequestInput;
    resolveChannelId?: ResolveSessionChannelId | undefined;
    source?: string | undefined;
    store: ChannelStore.ChannelStore;
}): Promise<Hex | undefined>;
/** Builds server bootstrap hints for a reusable precompile session channel. */
export declare function resolveSessionSnapshot(parameters: ResolveSessionSnapshotParameters): Promise<SessionSnapshot | undefined>;
/** Inputs for deciding whether a verified session credential should serve content. */
export type SessionResponseGateParameters = {
    /** Captured request metadata from the verification envelope, when available. */
    capturedRequest?: Parameters<typeof isSessionContentRequest>[0] | undefined;
    /** Raw HTTP request used as a fallback when no captured metadata exists. */
    input: Request;
    /** Credential payload or minimal action-bearing payload. */
    payload: SessionCredentialPayload | {
        action?: unknown;
    };
};
/**
 * Returns a management response for non-content session actions.
 *
 * `close` and `topUp` are always management-only. `open` and `voucher` serve
 * content only when the request classifier says the request is billable.
 */
export declare function respondToSessionCredential(parameters: SessionResponseGateParameters): Response | undefined;
type ChainIdClient = {
    chain?: {
        id?: number | undefined;
    } | undefined;
};
/** Public request input accepted by the tempo session method before schema normalization. */
export type SessionPaymentRequestInput = z.input<typeof Methods.session.schema.request>;
/** Canonical request shape embedded in signed `tempo/session` challenges. */
export type CanonicalSessionPaymentRequest = z.output<typeof Methods.session.schema.request>;
/** Canonical challenge request after required TIP-1034 method details have been proven present. */
export type VerifiedSessionPaymentRequest = CanonicalSessionPaymentRequest & {
    /** Required TIP-1034 method details for credential verification. */
    methodDetails: SessionMethodDetails;
};
/** Session request input after server-side chain, escrow, fee-payer, and snapshot defaults are added. */
export type ResolvedSessionPaymentRequest = SessionPaymentRequestInput & {
    chainId: number;
    escrowContract: Address;
    feePayer?: boolean | viem_Account | undefined;
    operator?: Address | undefined;
    sessionSnapshot?: SessionSnapshot | undefined;
};
/** TIP-1034 session details embedded in a payment challenge request. */
export type SessionMethodDetails = {
    /** Tempo chain ID used for voucher domain and channel ID checks. */
    chainId: number;
    /** TIP20EscrowChannel precompile address for this challenge. */
    escrowContract: Address;
    /** Whether this challenge allows fee-sponsored management transactions. */
    feePayer?: boolean | undefined;
    /** Fee token clients must use for open/top-up transactions. */
    feeToken?: Address | undefined;
    /** Minimum raw-unit increase required for voucher credentials. */
    minVoucherDelta?: string | undefined;
    /** Channel operator address the client should encode in new open transactions. */
    operator?: Address | undefined;
    /** Tempo session protocol version for this challenge. */
    sessionProtocol?: Constants.SessionProtocol | undefined;
};
/** Inputs used to resolve the chain ID for a session challenge. */
export type ResolveRequestChainIdParameters = {
    getClient(parameters: {
        chainId?: number | undefined;
    }): ChainIdClient | Promise<ChainIdClient>;
    parameterChainId?: number | undefined;
    requestChainId?: number | undefined;
};
/** Inputs used to enrich a server session payment request before challenge creation. */
export type ResolveSessionPaymentRequestParameters = {
    capturedRequest?: RequestBodyProbe | undefined;
    credential: Credential.Credential | null | undefined;
    decimals: number;
    defaultFeePayer?: viem_Account | undefined;
    getClient: ResolveRequestChainIdParameters['getClient'];
    minVoucherDelta?: string | undefined;
    parameterChainId?: number | undefined;
    parameterEscrowContract?: Address | undefined;
    parameterFeePayer?: ParameterFeePayer;
    request: SessionPaymentRequestInput;
    resolveChannelId?: ResolveSessionChannelId | undefined;
    source?: string | undefined;
    sseEnabled?: boolean | undefined;
    store: ChannelStore.ChannelStore;
};
/** Inputs used to resolve shared context for credential verification. */
export type ResolveCredentialVerificationContextParameters = {
    /** Configured local fee payer, hosted relay URL, or sponsorship flag. */
    feePayer?: ParameterFeePayer;
    /** Resolves a viem client for the challenge chain ID. */
    getClient(parameters: {
        chainId: number;
    }): PrecompileChain.TransactionClient | Promise<PrecompileChain.TransactionClient>;
    /** Default human-readable minimum voucher delta configured on `session()`. */
    minVoucherDelta?: string | undefined;
    /** Token decimals used to parse default minimum voucher delta. */
    decimals: number;
    /** Canonical or schema-input request being verified. */
    request: unknown;
};
/** Shared context derived from the HMAC-bound challenge request for credential verification. */
export type CredentialVerificationContext = {
    /** Canonical session request shape. */
    request: VerifiedSessionPaymentRequest;
    /** Required TIP-1034 method details embedded in the challenge request. */
    methodDetails: SessionMethodDetails;
    /** Challenge chain ID. */
    chainId: number;
    /** Challenge escrow precompile address. */
    escrow: Address;
    /** Client for precompile reads and transaction broadcasts. */
    client: PrecompileChain.TransactionClient;
    /** Fee payer authorized for this credential, when allowed. */
    feePayer?: ResolvedFeePayer;
    /** Minimum allowed voucher delta in raw token units. */
    minVoucherDelta: bigint;
};
/** Payment fields extracted from the credential challenge request. */
export type ChallengePaymentFields = {
    /** Raw request amount in token units. */
    amount: bigint;
    /** Token address expected by the server. */
    currency: Address;
    /** Payee address expected by the server. */
    recipient: Address;
};
/** Reads the destination, token, and raw amount from a session challenge request. */
export declare function getChallengePaymentFields(challenge: Challenge.Challenge): ChallengePaymentFields;
/** Resolves the chain ID from request override, method parameters, or client config. */
export declare function resolveRequestChainId(parameters: ResolveRequestChainIdParameters): Promise<number | undefined>;
/** Resolves request-time TIP-1034 details and server bootstrap hints for a challenge. */
export declare function resolveSessionPaymentRequest(parameters: ResolveSessionPaymentRequestParameters): Promise<ResolvedSessionPaymentRequest>;
/** Parses the canonical session request shape used during credential verification. */
export declare function resolveVerificationRequest(request: unknown): VerifiedSessionPaymentRequest;
/** Returns required TIP-1034 method details from a canonical session request. */
export declare function requireMethodDetails(request: VerifiedSessionPaymentRequest): SessionMethodDetails;
/** Resolves all non-payload verification context from a session challenge request. */
export declare function resolveCredentialVerificationContext(parameters: ResolveCredentialVerificationContextParameters): Promise<CredentialVerificationContext>;
export {};
//# sourceMappingURL=RequestState.d.ts.map