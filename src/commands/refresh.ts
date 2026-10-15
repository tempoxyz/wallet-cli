import type { Provider as CoreProvider } from "accounts";
import { Cli } from "incur";

import { destructive, type WalletCommand } from "../cli/command.js";
import { flag } from "../cli/describe.js";
import { refreshOptions, refreshOutput } from "../schemas/refresh.js";
import { cliGlobals, globalAlias } from "../schemas/shared.js";
import { resolveNetwork, type Network } from "../shared/network.js";
import { connect, createProvider } from "../provider.js";

export default {
  command: Cli.create("refresh", {
    description: "Refresh your access key without logging out",
    globals: cliGlobals,
    options: refreshOptions,
    alias: globalAlias,
    output: refreshOutput,
    async run({ globals, options }) {
      return refreshHandler({ ...options, network: globals.network });
    },
  }),
  annotations: {
    // Saves the requested network to the wallet store before approval, like `login`.
    refresh: { ...destructive, idempotentHint: false, openWorldHint: true },
  },
  describe: {
    name: "refresh",
    about: "Refresh your access key without logging out",
    args: [flag("no_browser", "--no-browser", "Do not attempt to open a browser")],
  },
} satisfies WalletCommand;

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
