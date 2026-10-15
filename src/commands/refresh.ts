import type { Provider as CoreProvider } from "accounts";

import { resolveNetwork, type Network } from "../shared/network.js";
import { connect, createProvider } from "../provider.js";

/**
 * Authorizes a new access key. The stored keys stay in place, so the current one remains usable
 * until the wallet app approves the new one.
 */
export async function refreshHandler(
  options: { network?: string | undefined; browser?: boolean | undefined },
  createRefreshProvider: (options: {
    network: Network;
    noBrowser?: boolean | undefined;
  }) => Promise<Pick<CoreProvider.Provider, "request">> = createProvider,
) {
  const network = await resolveNetwork(options.network);
  const result = await connect(
    await createRefreshProvider({ network, noBrowser: options.browser === false }),
    network,
  );

  return {
    accounts: result.accounts.map((account) => account.address),
    chainId: network.chainId,
  };
}
