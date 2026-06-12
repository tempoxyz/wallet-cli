import type { Provider as CoreProvider } from "accounts";
import { Provider } from "accounts/cli";

export function createProvider(
  options: {
    mpp?: boolean | undefined;
    network?: string | undefined;
    noBrowser?: boolean | undefined;
  } = {},
): CoreProvider.Provider {
  return Provider.create({
    mpp: options.mpp ?? true,
    testnet: options.network === "testnet" || process.env.TEMPO_WALLET_NETWORK === "testnet",
    ...(options.noBrowser
      ? {
          open(url: string) {
            throw new Error(`Open this URL to continue: ${url}`);
          },
        }
      : {}),
  }) as CoreProvider.Provider;
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
