import type { Provider as CoreProvider } from "accounts";
import { Provider, Storage } from "accounts/cli";

import { openExternal } from "./shared/process.js";

export function createProvider(
  options: {
    network?: string | undefined;
    noBrowser?: boolean | undefined;
  } = {},
): CoreProvider.Provider {
  return Provider.create({
    open(url) {
      console.error(`Continue at: ${url}`);
      if (!options.noBrowser) openExternal(url);
    },
    // Pull mode is the local-account-friendly MPP path for a CLI.
    mpp: { mode: "pull" },
    storage: Storage.filesystem(),
    testnet: options.network === "testnet" || process.env.TEMPO_WALLET_NETWORK === "testnet",
  });
}

export async function connect(provider: CoreProvider.Provider) {
  return provider.request({
    method: "wallet_connect",
    params: [
      {
        capabilities: {
          authorizeAccessKey: {
            expiry: Math.floor(Date.now() / 1000) + 86_400,
          },
        },
      },
    ],
  });
}
