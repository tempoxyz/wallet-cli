import {
  createSessionAdministration,
  createSqliteChannelStore,
  resolveTempoWalletAccount,
  type SessionAdministration,
} from "mppx/client/node";

import { chainId, createTempoPublicClient } from "../shared/network.js";
import { channelsDbPath } from "../shared/process.js";

/**
 * Runs a durable TIP-1034 administration operation against the same MPPx
 * SQLite store used by normal paid requests.
 */
export async function withSessionAdministration<Result>(
  network: string | undefined,
  operation: (administration: SessionAdministration) => Promise<Result> | Result,
): Promise<Result> {
  const expectedChain = chainId(network);
  const store = createSqliteChannelStore({ path: channelsDbPath() });
  try {
    const preferredAccessKey = store.latestAuthorizedSigner();
    const resolved = await resolveTempoWalletAccount({
      chainId: expectedChain,
      ...(preferredAccessKey ? { preferredAccessKey } : {}),
    });
    return await operation(
      createSessionAdministration({
        account: resolved.account,
        client: createTempoPublicClient(network),
        resolveAccount: async (authorizedSigner) =>
          (
            await resolveTempoWalletAccount({
              chainId: expectedChain,
              preferredAccessKey: authorizedSigner,
            })
          ).account,
        store,
      }),
    );
  } finally {
    store.close();
  }
}
