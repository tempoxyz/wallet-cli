import { Adapter, Keystore, Provider as CoreProvider } from "accounts";
import { cli, Storage } from "accounts/cli";
import { deviceCode } from "accounts/deviceCode";
import { http, toHex, type Address, type Transport } from "viem";

import { CtaError } from "./cli/incur-compat.js";
import { commandError, walletError } from "./shared/errors.js";
import { openExternal } from "./shared/process.js";
import { appUrl, networkName, parseNetwork, rpcUrl, type Network } from "./shared/network.js";
import { continuationCommand } from "./shared/next.js";
import { getRecord } from "./shared/utils.js";

export const accessKeyAuthorizationSeconds = 30 * 86_400;

/** The `accounts/cli` provider, with its wallet store loaded (see `walletProvider`). */
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
  return await walletProvider(adapter, options.network);
}

/**
 * The wallet store's chain that a provider keeps on disk while `held`, in place of the chain the
 * SDK saves; see `walletStorage`.
 */
type ChainHold = { held: boolean; chainId?: unknown };

/** The `ChainHold` of each provider `walletProvider` made, which `connect` sets. */
const chainHolds = new WeakMap<object, ChainHold>();

/**
 * A provider on `adapter` that saves to the wallet store through `walletStorage`. It resolves once
 * the provider has loaded the store, since the SDK's `getAccount` throws until then. A store that
 * fails to load, or does not load within the SDK's `hydrationTimeout` (10 seconds by default),
 * fails with a retryable `E_RUNTIME`, so no command runs on an empty store.
 */
async function walletProvider(adapter: Adapter.Adapter, network: Network) {
  const hold: ChainHold = { held: false };
  const provider = CoreProvider.create({
    adapter: releaseOnApproval(adapter, hold),
    // Pull mode is the local-account-friendly MPP path for a CLI.
    mpp: { mode: "pull" },
    storage: walletStorage(hold),
    testnet: network.name === "testnet",
    transports: walletTransports(),
  });
  chainHolds.set(provider, hold);
  await provider.ready().catch((error: unknown) => {
    throw walletError({
      code: "E_RUNTIME",
      message: "The wallet store could not be loaded. Run the command again.",
      retryable: true,
      ...(error instanceof Error ? { cause: error } : {}),
    });
  });
  return provider;
}

/**
 * The RPC transport for each network's chain, from `rpcUrl` like every other RPC the CLI makes.
 * Without them, the provider's clients (which fill, sign, and send its transactions) use viem's
 * default chain RPCs and ignore `TEMPO_RPC_URL`.
 */
function walletTransports(): Record<number, Transport> {
  return Object.fromEntries(
    ["mainnet", "testnet"].map((name) => {
      const { chainId } = parseNetwork(name);
      return [chainId, http(rpcUrl(chainId))];
    }),
  );
}

/**
 * `Storage.filesystem()`, saving the chain of `hold` to the wallet store while it is held. The SDK
 * saves a `wallet_connect`'s chain as the wallet's as soon as the request starts, before the wallet
 * app answers, so without the hold a request that is denied, expires, times out, or is interrupted
 * would leave every later command defaulting to that network.
 */
function walletStorage(hold: ChainHold): ReturnType<typeof Storage.filesystem> {
  const storage = Storage.filesystem();
  return {
    ...storage,
    setItem(name, value) {
      if (!hold.held || name !== "store") return storage.setItem(name, value);
      const item = getRecord(value);
      return storage.setItem(name, {
        ...item,
        state: { ...getRecord(item.state), chainId: hold.chainId },
      });
    },
  };
}

/**
 * `adapter`, releasing `hold` as soon as the wallet app returns the accounts for a `wallet_connect`.
 * The SDK saves those accounts in the same turn, so the chain switches in that write rather than in
 * a later write of its own.
 */
function releaseOnApproval(adapter: Adapter.Adapter, hold: ChainHold): Adapter.Adapter {
  return Adapter.define(adapter, (parameters) => {
    const instance = adapter(parameters);
    const { loadAccounts } = instance.actions;
    return {
      ...instance,
      actions: {
        ...instance.actions,
        loadAccounts: async (...args) => {
          const result = await loadAccounts(...args);
          hold.held = false;
          return result;
        },
      },
    };
  });
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
 * The provider store's saved chain. `accounts` types its store with zustand middleware types it
 * does not import, so `CoreProvider.Provider["store"]` is `never` here.
 */
type ChainProvider = { store: { getState(): { chainId: number } } };

/**
 * Refuses with `E_USAGE` and a login `cta` unless `provider`'s wallet store is still logged in on `network`. A
 * command checks the logged-in chain before it reviews a send, and another process can log in on
 * another chain while it waits, for example at a confirmation prompt. The provider, which loads
 * the store when it is created, falls back to wallet-app approval on its saved chain whenever no
 * access key can sign, so the send would then go out on that chain.
 */
export function requireChain(provider: object, network: Network) {
  const { chainId } = (provider as ChainProvider).store.getState();
  if (chainId === network.chainId) return;
  const command = continuationCommand(["wallet", "login"], network);
  throw new CtaError(
    commandError(
      "E_USAGE",
      `The wallet is now logged in on ${networkName(chainId)}, not ${networkName(network.chainId)}, so nothing was sent. Log in with '${command}', then retry.`,
      command,
    ),
  );
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
  return await walletProvider(adapter, options.network);
}

function deviceCodeUrl() {
  return new URL("/api/auth/device", appUrl).toString();
}

/**
 * Sends `wallet_connect` for `network`. For a provider `walletProvider` made, the wallet store keeps
 * its chain until the wallet app approves, and switches to `network` as the SDK saves the approved
 * accounts; a request that fails leaves it, and so does any later write from the same provider.
 */
export async function connect(provider: Pick<CoreProvider.Provider, "request">, network: Network) {
  const hold = chainHolds.get(provider);
  if (hold) {
    hold.chainId = getRecord(getRecord(await settleWalletStore()).state).chainId;
    hold.held = true;
  }
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
 * Waits for the SDK's queued writes to the wallet store and returns the store they left, or
 * `undefined` when it cannot be read. `Storage.filesystem()` runs a file's reads and writes in
 * order, so this read settles after every write queued before it.
 */
export async function settleWalletStore(): Promise<unknown> {
  return await Promise.resolve(Storage.filesystem().getItem("store")).catch(() => undefined);
}
