import { tempo } from "mppx/client";
import type { ChannelStore } from "mppx/client";
import { createSqliteChannelStore, type SqliteChannelStore } from "mppx/client/node";

type SessionManagerParameters = Parameters<typeof tempo.session.manager>[0];

export type ManagedSessionRequest = {
  channelStore?: ChannelStore | undefined;
  fetch: typeof globalThis.fetch;
  init: RequestInit;
  managerOptions: Omit<
    SessionManagerParameters,
    "bootstrap" | "channelStore" | "fetch" | "maxDeposit"
  >;
  maxDeposit?: string | undefined;
  url: string;
};

/**
 * Executes one paid request through MPPx's owned TIP-1034 session lifecycle.
 *
 * CLI callers default to the SQLite store shared with Tempo Wallet. MPPx
 * bootstraps from authenticated server state before consulting that local
 * cache, and validates recovered channels against Tempo on-chain state.
 */
export async function fetchManagedSession(parameters: ManagedSessionRequest) {
  const ownedStore = parameters.channelStore
    ? undefined
    : createRequestChannelStore(parameters.url);
  const channelStore = parameters.channelStore ?? ownedStore;
  try {
    const manager = tempo.session.manager({
      ...parameters.managerOptions,
      bootstrap: true,
      channelStore,
      fetch: parameters.fetch,
      ...(parameters.maxDeposit ? { maxDeposit: parameters.maxDeposit } : {}),
    });
    return await manager.fetch(parameters.url, parameters.init);
  } finally {
    ownedStore?.close();
  }
}

function createRequestChannelStore(url: string): SqliteChannelStore {
  return createSqliteChannelStore({
    namespace: new URL(url).origin,
    requestUrl: url,
  });
}
