import { Keystore, type Provider as CoreProvider } from "accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  // The SDK stops waiting for its store after 100ms; a slow read finishes well after that.
  const slow = async (read: () => Promise<unknown>) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return await read();
  };
  return {
    slow,
    /** Answers read `n` (from 1) of the wallet store, given the real read. */
    answer: (_n: number, read: () => Promise<unknown>) => slow(read),
    queue: Promise.resolve() as Promise<unknown>,
    reads: 0,
  };
});

vi.mock("accounts/cli", async (importOriginal) => {
  const actual = await importOriginal<typeof import("accounts/cli")>();
  return {
    ...actual,
    Storage: {
      ...actual.Storage,
      filesystem(options?: Parameters<typeof actual.Storage.filesystem>[0]) {
        const storage = actual.Storage.filesystem(options);
        return {
          ...storage,
          getItem<value>(name: string) {
            const n = ++store.reads;
            // Reads settle in order, as the SDK's filesystem storage runs them.
            const result = store.queue.then(() =>
              store.answer(n, async () => await storage.getItem<value>(name)),
            );
            store.queue = result.catch(() => undefined);
            return result as Promise<value | null>;
          },
        };
      },
    },
  };
});

import { connect, createLoginProvider, createProvider, requireSender } from "../src/provider.js";
import { emptyWalletState, loadWalletState, saveWalletState } from "../src/wallet/store.js";
import { deviceCodeHost } from "./device-code-host.js";
import {
  testAccessKey,
  testWallet,
  testWallet2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

beforeEach(async () => {
  store.answer = (_n, read) => store.slow(read);
  store.queue = Promise.resolve();
  store.reads = 0;
  await useTempHome();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mainnet = { name: "mainnet", chainId: 4217 } as const;
// The wallet's only stored key is for testnet, so the provider sends mainnet signing requests to
// the wallet app, which rejects every request here.
const storedKey = { ...walletState().accessKeys[0]!, chainId: 42431 };
const reachedWallet = /device-code \/register returned status 500/;
const storeError = "The wallet store could not be loaded. Run the command again.";

describe("provider with a slow wallet store", () => {
  it.each<{
    name: string;
    accounts?: { address: string }[];
    answer?: typeof store.answer;
    provider?: () => Promise<CoreProvider.Provider>;
    run: (provider: CoreProvider.Provider) => Promise<unknown>;
    expected: { resolves: unknown } | { rejects: RegExp | string };
  }>([
    {
      name: "sends a transaction through the wallet app",
      run: (provider) =>
        provider.request({
          method: "eth_sendTransactionSync",
          params: [{ calls: [{ to: testWallet2, data: "0x" }] }],
        }),
      expected: { rejects: reachedWallet },
    },
    {
      name: "signs typed data through the wallet app",
      run: (provider) =>
        provider.request({
          method: "eth_signTypedData_v4",
          params: [
            testWallet,
            JSON.stringify({
              domain: { name: "Test", version: "1", chainId: 4217 },
              message: { value: "1" },
              primaryType: "Test",
              types: {
                EIP712Domain: [
                  { name: "name", type: "string" },
                  { name: "version", type: "string" },
                  { name: "chainId", type: "uint256" },
                ],
                Test: [{ name: "value", type: "string" }],
              },
            }),
          ],
        }),
      expected: { rejects: reachedWallet },
    },
    {
      name: "lists the stored account",
      run: (provider) => provider.request({ method: "eth_accounts" }),
      expected: { resolves: [testWallet] },
    },
    {
      name: "looks up the stored account",
      run: async (provider) => provider.getAccount({ address: testWallet }).address,
      expected: { resolves: testWallet },
    },
    {
      // A later read must not replace the first one's result.
      name: "keeps the loaded store when a later read fails",
      answer: (n, read) =>
        n === 1
          ? store.slow(read)
          : read().then(() => {
              throw new Error("unreadable");
            }),
      run: (provider) => provider.request({ method: "eth_accounts" }),
      expected: { resolves: [testWallet] },
    },
    {
      name: "loads the store again when only the first read fails",
      answer: (n, read) =>
        n === 1
          ? store.slow(read).then(() => {
              throw new Error("unreadable");
            })
          : read(),
      run: (provider) => provider.request({ method: "eth_accounts" }),
      expected: { resolves: [testWallet] },
    },
    {
      name: "fails with E_RUNTIME when the store cannot be read",
      answer: (_n, read) =>
        read().then(() => {
          throw new Error("unreadable");
        }),
      run: async () => undefined,
      expected: { rejects: storeError },
    },
    {
      name: "sends from the wallet a command checked",
      run: async (provider) => requireSender(provider, testWallet.toLowerCase()),
      expected: { resolves: testWallet },
    },
    {
      name: "refuses to send once another login replaced the checked wallet",
      accounts: [{ address: testWallet2 }],
      run: async (provider) => requireSender(provider, testWallet),
      expected: {
        rejects: `Wallet ${testWallet.toLowerCase()} is no longer logged in, so nothing was sent. Check the login with 'tempo wallet whoami', then retry.`,
      },
    },
    {
      // The SDK saves its store as `wallet_connect` starts and again once the wallet approves.
      name: "keeps the stored keys through a login the wallet approves at once",
      provider: () =>
        createLoginProvider({
          network: mainnet,
          fetch: deviceCodeHost(() => "approve").fetch,
          keystore: Keystore.webCryptoP256({ extractable: true }),
        }),
      run: async (provider) => {
        await connect(provider, mainnet);
        return (await loadWalletState()).accessKeys.map((key) => key.address);
      },
      expected: { resolves: expect.arrayContaining([testAccessKey]) },
    },
  ])(
    "$name",
    async ({
      accounts,
      answer,
      provider = () => createProvider({ network: mainnet }),
      run,
      expected,
    }) => {
      await writeWalletState(
        walletState({ accessKeys: [storedKey], ...(accounts ? { accounts } : {}) }),
      );
      if (answer) store.answer = answer;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 500 })),
      );

      const result = provider().then(run);

      if ("resolves" in expected) await expect(result).resolves.toEqual(expected.resolves);
      else await expect(result).rejects.toThrow(expected.rejects);
    },
  );

  it.each([
    { name: "logout", other: emptyWalletState() },
    { name: "login", other: walletState({ accounts: [{ address: testWallet2 }] }) },
  ])(
    "keeps another process's $name that lands as an approved login on another network finishes",
    async ({ other }) => {
      await writeWalletState(walletState());
      const testnet = { name: "testnet", chainId: 42431 } as const;
      let approved = false;
      let written = false;
      // The other process writes the store during the first read after the wallet approves.
      store.answer = async (_n, read) => {
        const value = await read();
        if (approved && !written) {
          written = true;
          await saveWalletState(other);
        }
        return value;
      };
      const provider = await createLoginProvider({
        network: testnet,
        fetch: deviceCodeHost(() => {
          approved = true;
          return "approve";
        }).fetch,
        keystore: Keystore.webCryptoP256({ extractable: true }),
      });

      await connect(provider, testnet);

      expect(written).toBe(true);
      expect((await loadWalletState()).accounts).toEqual(other.accounts);
    },
  );

  it("fails with E_RUNTIME when the store never loads", async () => {
    await writeWalletState(walletState());
    store.answer = () => new Promise(() => undefined);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const result = createProvider({ network: mainnet });
    const assertion = expect(result).rejects.toMatchObject({ code: "E_RUNTIME" });
    await vi.advanceTimersByTimeAsync(60_000);

    await assertion;
    await expect(result).rejects.toThrow(storeError);
  });
});
