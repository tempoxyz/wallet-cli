import type { Provider as CoreProvider } from "accounts";
import { Provider, Storage } from "accounts/cli";

import { openExternal } from "./shared/process.js";
import { appUrl, isTestnet } from "./shared/network.js";

export const accessKeyAuthorizationSeconds = 30 * 86_400;

export function createProvider(
  options: {
    network?: string | undefined;
    noBrowser?: boolean | undefined;
  } = {},
): CoreProvider.Provider {
  return Provider.create({
    ...(process.env.TEMPO_AUTH_URL ? { host: new URL("/api/auth/device", appUrl).toString() } : {}),
    open(url, prompt) {
      const code = prompt.userCode.replace(/^(.{4})(.{4})$/, "$1-$2");
      console.error(`Device confirmation code: ${code}`);
      console.error(`Continue at: ${url}`);
      if (!options.noBrowser) openExternal(url);
    },
    // Pull mode is the local-account-friendly MPP path for a CLI.
    mpp: { mode: "pull" },
    storage: Storage.filesystem(),
    testnet: isTestnet(options.network),
  });
}

export async function connect(provider: CoreProvider.Provider) {
  return provider.request({
    method: "wallet_connect",
    params: [
      {
        capabilities: {
          authorizeAccessKey: {
            expiry: Math.floor(Date.now() / 1000) + accessKeyAuthorizationSeconds,
          },
          showDeposit: true,
        },
      },
    ],
  });
}
