import type { ChannelEntry } from '../../tempo/session/client/ChannelOps.js';
import { sessionManager, type SessionManager } from '../../tempo/session/client/SessionManager.js';
import type { TempoSessionChallenge } from '../../tempo/session/client/Transports.js';
import type { SessionReceipt } from '../../tempo/session/precompile/Protocol.js';
type ManagerParameters = Omit<sessionManager.Parameters, 'bootstrap' | 'fetch'>;
/** Inputs for closing a durable session through a newly created manager. */
export type CloseWithSessionManagerParameters = {
    /** Durable open channel entry. */
    channel: ChannelEntry;
    /** Latest validated challenge for the channel scope. */
    challenge: TempoSessionChallenge;
    /** Network fetch used for the cooperative close request. Defaults to global fetch. */
    fetch?: typeof globalThis.fetch | undefined;
    /** Exact resource URL used as the cooperative close endpoint. */
    input: RequestInfo | URL;
    /** Session manager account, client, policy, and channel-store parameters. */
    manager: ManagerParameters;
    /** Persists a validated refreshed close challenge before retrying. */
    onChallenge?: ((challenge: TempoSessionChallenge) => void | Promise<void>) | undefined;
    /** Latest receipt-confirmed spend in raw token units. */
    spent: bigint;
};
/** Result of a rehydrated cooperative close. */
export type CloseWithSessionManagerResult = {
    manager: SessionManager;
    receipt: SessionReceipt;
};
/** Rehydrates durable session context and cooperatively closes it through the manager. */
export declare function closeWithSessionManager(parameters: CloseWithSessionManagerParameters): Promise<CloseWithSessionManagerResult>;
export {};
//# sourceMappingURL=Manager.d.ts.map