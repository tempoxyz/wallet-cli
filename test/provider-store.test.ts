import { Keystore, type Provider as CoreProvider } from "accounts";
import { afterEach, describe, expect, it, vi } from "vitest";

// The SDK stops waiting for its store after 100ms; these reads finish well after that.
const storeReadDelay = 300;

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
          async getItem<value>(name: string) {
            await new Promise((resolve) => setTimeout(resolve, storeReadDelay));
            return await storage.getItem<value>(name);
          },
        };
      },
    },
  };
});

import { connect, createLoginProvider, createProvider } from "../src/provider.js";
import { loadWalletState } from "../src/wallet/store.js";
import { deviceCodeHost } from "./device-code-host.js";
import {
  testAccessKey,
  testWallet,
  testWallet2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const mainnet = { name: "mainnet", chainId: 4217 } as const;
// The wallet's only stored key is for testnet, so the provider sends mainnet signing requests to
// the wallet app, which rejects every request here.
const storedKey = { ...walletState().accessKeys[0]!, chainId: 42431 };
const reachedWallet = /device-code \/register returned status 500/;

describe("provider with a slow wallet store", () => {
  it.each<{
    name: string;
    provider?: () => Promise<CoreProvider.Provider>;
    run: (provider: CoreProvider.Provider) => Promise<unknown>;
    expected: { resolves: unknown } | { rejects: RegExp };
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
  ])("$name", async ({ provider = () => createProvider({ network: mainnet }), run, expected }) => {
    await useTempHome();
    await writeWalletState(walletState({ accessKeys: [storedKey] }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    const result = run(await provider());

    if ("resolves" in expected) await expect(result).resolves.toEqual(expected.resolves);
    else await expect(result).rejects.toThrow(expected.rejects);
  });
});
