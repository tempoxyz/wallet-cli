import type { Provider as CoreProvider } from "accounts";
import { Provider, Storage } from "accounts/cli";
import { parseUnits, toHex } from "viem";

import { openExternal } from "./shared/process.js";
import { moderatoToken, usdcToken } from "./shared/constants.js";

export const accessKeyAuthorizationSeconds = 30 * 86_400;

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

export function accessKeyLimits(network: string | undefined) {
  const tokens = network === "testnet" ? [moderatoToken] : [usdcToken, moderatoToken];
  return tokens.map((token) => ({ limit: toHex(parseUnits("100", 6)), token }));
}

export async function connect(provider: CoreProvider.Provider, network?: string | undefined) {
  return provider.request({
    method: "wallet_connect",
    params: [
      {
        capabilities: {
          authorizeAccessKey: {
            expiry: Math.floor(Date.now() / 1000) + accessKeyAuthorizationSeconds,
            limits: accessKeyLimits(network),
          },
        },
      },
    ],
  });
}
