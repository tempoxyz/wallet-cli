/** Workarounds for accounts SDK bugs. */
import { Adapter, type Provider as CoreProvider } from "accounts";
import { Storage } from "accounts/cli";
import type { Transport } from "viem";

import { usageError, walletError } from "../shared/errors.js";

/**
 * The provider store's persistence API; see `ChainProvider` in `provider.ts` for why it is typed
 * here.
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
 *
 * Upstream: https://github.com/tempoxyz/accounts/pull/878 adds `provider.ready()`. Remove once
 * accounts > 0.19.0 includes tempoxyz/accounts#878, awaiting `provider.ready()` instead and keeping
 * this `E_RUNTIME` error.
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
 * The SDK sends wallet-account requests such as `wallet_revokeAccessKey` through viem's `custom`
 * transport, which retries a failed or timed-out request up to three times. Each attempt is a new
 * device-code approval, so the transport it returns is set to send each request once.
 *
 * Upstream: https://github.com/tempoxyz/accounts/pull/877. Remove once accounts > 0.19.0 includes
 * tempoxyz/accounts#877.
 */
export function withoutRetries(adapter: Adapter.Adapter): Adapter.Adapter {
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

/**
 * Refuses with `E_USAGE` unless the provider's active chain is `chainId`: `wallet_revokeAccessKey`
 * takes no chain, so the wallet revokes on the provider's active chain, which must be the key's.
 *
 * Upstream: https://github.com/tempoxyz/accounts/pull/879. Remove once accounts > 0.19.0 includes
 * tempoxyz/accounts#879, passing the key's `chainId` with the revoke instead.
 */
export async function requireRevokeChain(options: {
  provider: Pick<CoreProvider.Provider, "request">;
  chainId: number;
}) {
  const activeChainId = Number(await options.provider.request({ method: "eth_chainId" }));
  if (activeChainId !== options.chainId)
    throw usageError(
      "Wallet is not configured for the requested network. Run 'tempo wallet login'.",
    );
}
