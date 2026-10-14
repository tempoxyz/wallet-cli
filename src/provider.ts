import { Adapter, Keystore, Provider as CoreProvider } from "accounts";
import { cli, Storage } from "accounts/cli";
import { deviceCode } from "accounts/deviceCode";
import { toHex, type Transport } from "viem";

import { openExternal } from "./shared/process.js";
import { appUrl, type Network } from "./shared/network.js";

export const accessKeyAuthorizationSeconds = 30 * 86_400;

/** The `accounts/cli` provider, with wallet-app requests sent once (see `withoutRetries`). */
export function createProvider(options: {
  network: Network;
  noBrowser?: boolean | undefined;
}): CoreProvider.Provider {
  const adapter = cli({
    host: deviceCodeUrl(),
    open(url, prompt) {
      const code = prompt.userCode.replace(/^(.{4})(.{4})$/, "$1-$2");
      console.error(`Device confirmation code: ${code}`);
      console.error(`Continue at: ${url}`);
      if (!options.noBrowser) openExternal(url);
    },
  });
  return CoreProvider.create({
    adapter: withoutRetries(adapter),
    // Pull mode is the local-account-friendly MPP path for a CLI.
    mpp: { mode: "pull" },
    storage: Storage.filesystem(),
    testnet: options.network.name === "testnet",
  });
}

/**
 * A `wallet_connect` provider set up like `createProvider`, except that the caller supplies the
 * device-code transport's `fetch` and the p256 access-key keystore, so a login can register a
 * device code in one process and finish polling it in another. The caller shows the prompt.
 */
export function createLoginProvider(options: {
  network: Network;
  fetch: typeof globalThis.fetch;
  keystore: Keystore.Keystore;
  /** Milliseconds between `/token` polls; defaults to the interval the wallet advertises. */
  pollingInterval?: number | undefined;
  /** Milliseconds to wait for approval; defaults to the SDK's five minutes. */
  timeout?: number | undefined;
}): CoreProvider.Provider {
  const adapter = deviceCode({
    fetch: options.fetch,
    // The same keystores `accounts/cli` uses: keys must survive the JSON wallet store.
    keystores: { p256: options.keystore, secp256k1: Keystore.secp256k1() },
    meta: { name: "Tempo CLI" },
    name: "Tempo CLI",
    onPrompt: () => undefined,
    ...(options.pollingInterval !== undefined ? { pollingInterval: options.pollingInterval } : {}),
    rdns: "xyz.tempo.cli",
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    url: deviceCodeUrl(),
  });
  return CoreProvider.create({
    adapter: withoutRetries(adapter),
    mpp: { mode: "pull" },
    storage: Storage.filesystem(),
    testnet: options.network.name === "testnet",
  });
}

function deviceCodeUrl() {
  return new URL("/api/auth/device", appUrl).toString();
}

/**
 * The SDK sends wallet-account requests such as `wallet_revokeAccessKey` through viem's `custom`
 * transport, which retries a failed or timed-out request up to three times. Each attempt is a new
 * device-code approval, so the transport it returns is set to send each request once.
 */
function withoutRetries(adapter: Adapter.Adapter): Adapter.Adapter {
  return Adapter.define(adapter, (parameters) => {
    const instance = adapter(parameters);
    const { getAccount } = instance;
    if (!getAccount) return instance;
    return {
      ...instance,
      getAccount: (async (options) => {
        const selected = await getAccount(options);
        const { transport } = selected;
        if (!transport) return selected;
        return {
          ...selected,
          transport: ((config) => transport({ ...config, retryCount: 0 })) as Transport,
        };
      }) as typeof getAccount,
    };
  });
}

export async function connect(provider: Pick<CoreProvider.Provider, "request">, network: Network) {
  try {
    return await provider.request({
      method: "wallet_connect",
      params: [
        {
          // Persisted SDK state can override the provider's testnet default.
          chainId: toHex(network.chainId),
          capabilities: {
            authorizeAccessKey: {
              expiry: Math.floor(Date.now() / 1000) + accessKeyAuthorizationSeconds,
            },
            showDeposit: true,
          },
        },
      ],
    });
  } finally {
    // Wait for the SDK to save the wallet store, so later reads in this process see the result.
    await Promise.resolve(Storage.filesystem().getItem("store")).catch(() => undefined);
  }
}

/**
 * Waits for the SDK's queued writes to the wallet store. `Storage.filesystem()` runs a file's
 * reads and writes in order, so this read settles after every write queued before it.
 */
export async function settleWalletStore() {
  await Promise.resolve(Storage.filesystem().getItem("store")).catch(() => undefined);
}
