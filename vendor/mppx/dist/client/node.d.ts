import { type ChannelStore } from '../tempo/session/client/ChannelStore.js';
/** Options for the Node SQLite-backed payer channel store. */
export type SqliteChannelStoreOptions = {
    /** Service namespace, normally the protected API origin. */
    namespace?: string | undefined;
    /** SQLite file path. Defaults to Tempo Wallet's shared channel database. */
    path?: string | undefined;
    /** Full protected URL retained for CLI session-management requests. */
    requestUrl?: string | undefined;
};
/** A SQLite-backed channel store that can release its database handle. */
export type SqliteChannelStore = ChannelStore & {
    /** Absolute or caller-supplied path opened by this store. */
    readonly path: string;
    /** Closes the underlying SQLite connection. */
    close(): void;
};
/** Returns the channel database shared by Tempo command-line applications. */
export declare function defaultChannelDatabasePath(): string;
/**
 * Creates a synchronous Node SQLite implementation of {@link ChannelStore}.
 *
 * The schema is compatible with Tempo Wallet's existing `channels` table, so
 * a fresh MPPx client can reuse v2 session records without a separate migration
 * command. A namespace keeps identical payment scopes at different services
 * isolated from one another.
 */
export declare function createSqliteChannelStore(options?: SqliteChannelStoreOptions): SqliteChannelStore;
//# sourceMappingURL=node.d.ts.map