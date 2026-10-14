import { Adapter, Keystore, Provider as CoreProvider } from "accounts";
import { cli, Storage } from "accounts/cli";
import { deviceCode } from "accounts/deviceCode";
import { toHex, type Address, type Transport } from "viem";

import { walletError } from "./shared/errors.js";
import { openExternal } from "./shared/process.js";
import { appUrl, type Network } from "./shared/network.js";

export const accessKeyAuthorizationSeconds = 30 * 86_400;

/**
 * The `accounts/cli` provider, with its wallet store loaded (see `providerReady`) and wallet-app
 * requests sent once (see `withoutRetries`).
 */
export async function createProvider(options: {
  network: Network;
  noBrowser?: boolean | undefined;
}): Promise<CoreProvider.Provider> {
  const adapter = cli({
    host: deviceCodeUrl(),
    open(url, prompt) {
      const code = prompt.userCode.replace(/^(.{4})(.{4})$/, "$1-$2");
      console.error(`Device confirmation code: ${code}`);
      console.error(`Continue at: ${url}`);
      if (!options.noBrowser) openExternal(url);
    },
  });
  const provider = CoreProvider.create({
    adapter: withoutRetries(adapter),
    // Pull mode is the local-account-friendly MPP path for a CLI.
    mpp: { mode: "pull" },
    storage: Storage.filesystem(),
    testnet: options.network.name === "testnet",
  });
  return await providerReady(provider);
}

/**
 * The provider store's persistence API. `accounts` types its store with zustand middleware types it
 * does not import, so `CoreProvider.Provider["store"]` is `never` here.
 */
type HydratingProvider = {
  store: { persist: { hasHydrated(): boolean; rehydrate(): Promise<void> | void } };
};

/** How long `providerReady` waits for the wallet store to load. */
const storeLoadTimeout = 10_000;

/**
 * Resolves with `provider` once its store holds the persisted wallet state, for a provider on the
 * default `Storage.filesystem()` wallet store.
 *
 * The SDK loads its store asynchronously and waits at most 100ms for it before a request, and
 * `getAccount` reads it without waiting. On a slow machine the provider then has no accounts: it
 * fails with "No accounts connected." or `Account "0x…" not found.`, `eth_accounts` returns none,
 * and `wallet_connect` saves the empty store over the stored accounts and keys. Call this on every
 * provider before using it.
 *
 * The store's first read exposes no promise, and a failed one never finishes hydrating. Starting a
 * second hydration while it runs would discard its result, so this waits for a read queued behind
 * it instead: `Storage.filesystem()` runs a file's reads and writes in order. Only when the first
 * read failed and that one succeeded does it hydrate again. A store that has not loaded within
 * `storeLoadTimeout` fails with `E_RUNTIME`, so no command runs on an empty store.
 */
export async function providerReady<provider extends HydratingProvider>(
  provider: provider,
): Promise<provider> {
  const { persist } = provider.store;
  if (persist.hasHydrated()) return provider;
  const read = await beforeStoreTimeout(
    Promise.resolve(Storage.filesystem().getItem("store")).then(
      () => ({ error: undefined }),
      (error: unknown) => ({ error }),
    ),
  );
  if (read && read.error === undefined && !persist.hasHydrated())
    await beforeStoreTimeout(Promise.resolve(persist.rehydrate()));
  if (persist.hasHydrated()) return provider;
  throw walletError({
    code: "E_RUNTIME",
    message: "The wallet store could not be loaded. Run the command again.",
    retryable: true,
    ...(read?.error instanceof Error ? { cause: read.error } : {}),
  });
}

/** Resolves with `promise`'s value, or with `undefined` once `storeLoadTimeout` has passed. */
async function beforeStoreTimeout<value>(promise: Promise<value>): Promise<value | undefined> {
  const timeout = Promise.withResolvers<undefined>();
  const timer = setTimeout(() => timeout.resolve(undefined), storeLoadTimeout);
  try {
    return await Promise.race([promise, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns the address to send from: `address`, the wallet a command checked, as the provider
 * stores it. A command checks a wallet's balance and limits before sending, and another process
 * can log in a different wallet in between; a send without `from` would then go out from that
 * wallet. This refuses with `E_NOT_AUTHENTICATED` when the provider no longer holds `address`.
 */
export function requireSender(
  provider: Pick<CoreProvider.Provider, "getAccount">,
  address: string,
): Address {
  try {
    return provider.getAccount({ address: address as Address }).address;
  } catch {
    throw walletError({
      code: "E_NOT_AUTHENTICATED",
      message: `Wallet ${address.toLowerCase()} is no longer logged in, so nothing was sent. Check the login with 'tempo wallet whoami', then retry.`,
    });
  }
}

/**
 * A `wallet_connect` provider set up like `createProvider`, except that the caller supplies the
 * device-code transport's `fetch` and the p256 access-key keystore, so a login can register a
 * device code in one process and finish polling it in another. The caller shows the prompt.
 */
export async function createLoginProvider(options: {
  network: Network;
  fetch: typeof globalThis.fetch;
  keystore: Keystore.Keystore;
  /** Milliseconds between `/token` polls; defaults to the interval the wallet advertises. */
  pollingInterval?: number | undefined;
  /** Milliseconds to wait for approval; defaults to the SDK's five minutes. */
  timeout?: number | undefined;
}): Promise<CoreProvider.Provider> {
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
  return await providerReady(
    CoreProvider.create({
      adapter: withoutRetries(adapter),
      mpp: { mode: "pull" },
      storage: Storage.filesystem(),
      testnet: options.network.name === "testnet",
    }),
  );
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
    await settleWalletStore();
  }
}

/**
 * Waits for the SDK's queued writes to the wallet store. `Storage.filesystem()` runs a file's
 * reads and writes in order, so this read settles after every write queued before it.
 */
export async function settleWalletStore() {
  await Promise.resolve(Storage.filesystem().getItem("store")).catch(() => undefined);
}
