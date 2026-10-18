import type { Address, Hex } from 'viem';
import * as Challenge from '../../Challenge.js';
import { type ChannelEntry } from '../../tempo/session/client/ChannelOps.js';
import { type ChannelStore } from '../../tempo/session/client/ChannelStore.js';
import { type TempoSessionChallenge } from '../../tempo/session/client/Transports.js';
import type { SessionReceipt } from '../../tempo/session/precompile/Protocol.js';
declare const sessionStateVersion: 1;
/** Lifecycle state recorded for a managed CLI session. */
export type SessionStatus = 'opening' | 'open' | 'closing' | 'stale';
/** Account identity required to resume or close a managed session. */
export type SessionAccount = {
    /** Optional mppx account name. */
    name?: string | undefined;
    /** Payer wallet address. */
    address: Address;
};
/** Payment scope used to isolate preferred sessions and process locks. */
export type SessionScope = {
    payer: Address;
    payee: Address;
    token: Address;
    escrow: Address;
    chainId: number;
};
/** Durable session record returned by the CLI registry. */
export type ManagedSession = {
    version: typeof sessionStateVersion;
    status: SessionStatus;
    channel: ChannelEntry;
    account: SessionAccount;
    endpoint: string;
    challenge: TempoSessionChallenge;
    receipt?: SessionReceipt | undefined;
    spent: bigint;
    units: number;
    createdAt: string;
    updatedAt: string;
};
/** Input persisted by {@link SessionRegistry.upsert}. */
export type SessionUpsert = {
    status: SessionStatus;
    channel: ChannelEntry;
    account: SessionAccount;
    endpoint: string;
    challenge: Challenge.Challenge;
    receipt?: SessionReceipt | undefined;
    spent?: bigint | undefined;
    units?: number | undefined;
};
/** Dynamic context used when adapting the registry to the SDK channel store. */
export type SessionPersistenceContext = Omit<SessionUpsert, 'channel'>;
/** Selection policy used by a persistent CLI request. */
export type SessionSelection = 'auto' | 'new' | Hex;
/** Held process lock for a session scope. */
export type SessionLock = {
    /** Releases the lock if this process still owns it. */
    release(): Promise<void>;
};
/** Filesystem-backed persistent session registry. */
export type SessionRegistry = {
    /** Versioned registry root. */
    readonly root: string;
    /** Returns a managed session by full channel ID. */
    get(channelId: string): Promise<ManagedSession | undefined>;
    /** Lists managed sessions. */
    list(): Promise<ManagedSession[]>;
    /** Creates or monotonically updates a managed session. */
    upsert(input: SessionUpsert): Promise<ManagedSession>;
    /** Removes a validated managed session and its preferred mappings. */
    remove(channelId: string): Promise<void>;
    /** Returns the preferred channel ID for a payer and payment scope. */
    getPreferred(scope: SessionScope): Promise<Hex | undefined>;
    /** Sets the preferred channel after verifying it matches the scope. */
    setPreferred(scope: SessionScope, channelId: string): Promise<void>;
    /** Clears the preferred channel, optionally only when it matches `channelId`. */
    clearPreferred(scope: SessionScope, channelId?: string | undefined): Promise<void>;
    /** Acquires an exclusive process lock for a payer and payment scope. */
    acquire(scope: SessionScope): Promise<SessionLock>;
};
/** Options for {@link createSessionRegistry}. */
export type CreateSessionRegistryOptions = {
    /** Override the versioned state root. */
    stateRoot?: string | undefined;
    /** Host identity written to lock files. */
    hostname?: string | undefined;
    /** Process ID written to lock files. */
    pid?: number | undefined;
    /** Clock used for persisted timestamps. */
    now?: (() => Date) | undefined;
    /** Process liveness probe used for same-host lock reclamation. */
    isProcessAlive?: ((pid: number) => boolean) | undefined;
};
/** Invalid, corrupt, or inconsistent persistent session state. */
export declare class SessionStateError extends Error {
    readonly name = "SessionStateError";
    readonly code = "SESSION_STATE_INVALID";
    readonly file?: string | undefined;
    constructor(message: string, options?: {
        cause?: unknown;
        file?: string | undefined;
    });
}
/** A session scope currently owned by another live process. */
export declare class SessionBusyError extends Error {
    readonly name = "SessionBusyError";
    readonly code = "SESSION_BUSY";
    readonly exitCode = 75;
    readonly scope: string;
    readonly owner: {
        hostname: string;
        pid: number;
    };
    constructor(scope: string, owner: {
        hostname: string;
        pid: number;
    });
}
/** Returns the stable payer-qualified key for a persistent session scope. */
export declare function sessionScopeKey(scope: SessionScope): string;
/** Returns the persistent payment scope for a channel. */
export declare function sessionScope(channel: ChannelEntry): SessionScope;
/** Creates a filesystem-backed CLI session registry. */
export declare function createSessionRegistry(options?: CreateSessionRegistryOptions): SessionRegistry;
/** Adapts a persistent registry selection to the session manager's channel store. */
export declare function toChannelStore(registry: SessionRegistry, options: {
    scope: SessionScope;
    selection: SessionSelection;
    context: () => SessionPersistenceContext;
    onNewChannel?: ((channel: ChannelEntry) => void) | undefined;
}): ChannelStore;
/** Returns the exact HTTP resource URL persisted for session management. */
export declare function sessionResourceUrl(endpoint: unknown, file?: string | undefined): string;
export {};
//# sourceMappingURL=store.d.ts.map