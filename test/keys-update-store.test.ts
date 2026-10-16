import { Adapter, Provider } from "accounts";
import { Storage } from "accounts/cli";
import type { Address } from "viem";
import { Account } from "viem/tempo";
import { afterEach, expect, it } from "vitest";

import { updateAccessKeyHandler } from "../src/commands/keys.js";
import { usdcToken } from "../src/shared/constants.js";
import { loadWalletState, type WalletState } from "../src/wallet/store.js";
import {
  ousdToken,
  readyWallet,
  testAccessKey,
  testAccessKey2,
  testPrivateKey2,
  testWallet,
  testWallet2,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

type KeyAuthorization = Awaited<ReturnType<typeof keyAuthorization>>;

/** The SDK store's access-key operation the test wallet uses. */
type AccessKeyStore = {
  accessKeys: {
    updateAuthorization(options: {
      accessKey: Address;
      account: Address;
      authorization: KeyAuthorization;
      chainId: number;
    }): void;
  };
};

const expiry = 2_000_000_000;

afterEach(async () => {
  // Drain the SDK's filesystem write queue before the temp home is removed.
  await Storage.filesystem().getItem("store");
});

/** A signed authorization for `testAccessKey` limited to `limit` USDC.e; nothing verifies it. */
async function keyAuthorization(limit: bigint) {
  return await Account.fromSecp256k1(testPrivateKey2).signKeyAuthorization(
    { address: testAccessKey, type: "secp256k1" },
    { chainId: 4217n, expiry, limits: [{ token: usdcToken, limit }] },
  );
}

/**
 * The SDK provider on the real filesystem storage, once it has loaded the store. Like
 * `accounts/cli`'s adapter, it saves the replacement authorization the wallet returns for an
 * unpublished key through the SDK store, which writes the wallet store in the background. `saved`
 * waits for that write before the request returns.
 */
async function walletProvider(replacement: KeyAuthorization | undefined, saved: boolean) {
  const adapter = Adapter.define({ name: "Test wallet" }, (parameters) => {
    // The SDK's store type needs zustand's middleware types, which this package does not load.
    const store: AccessKeyStore = parameters.store;
    return {
      actions: {
        createAccount: async () => {
          throw new Error("Unexpected account creation");
        },
        loadAccounts: async () => {
          throw new Error("Unexpected login");
        },
        async updateAccessKey(update) {
          if (!replacement) return;
          store.accessKeys.updateAuthorization({
            accessKey: update.accessKeyAddress,
            account: update.address,
            authorization: replacement,
            chainId: Number(update.chainId),
          });
          if (saved) await Storage.filesystem().getItem("store");
        },
      },
    };
  });
  const provider = Provider.create({ adapter, storage: Storage.filesystem() });
  await provider.ready();
  return provider;
}

const usdcLimit = (limit: string) => ({ token: usdcToken, limit: `${limit}#__bigint` });
const ousdLimit = { token: ousdToken, limit: "5000000#__bigint" };

it.each([
  {
    name: "an unpublished key saved before the request returns",
    published: false,
    saved: true,
    // The wallet's replacement authorization carries only the requested limit.
    limits: [usdcLimit("250000000")],
  },
  {
    name: "an unpublished key saved after the request returns",
    published: false,
    saved: false,
    limits: [usdcLimit("250000000")],
  },
  {
    name: "a published key",
    published: true,
    saved: false,
    limits: [usdcLimit("250000000"), ousdLimit],
  },
])(
  "keys update keeps the wallet's authorization for $name",
  async ({ published, saved, limits }) => {
    await useTempHome();
    const pending = published ? undefined : await keyAuthorization(100_000_000n);
    const replacement = published ? undefined : await keyAuthorization(250_000_000n);
    const key: WalletState["accessKeys"][number] = {
      ...walletState().accessKeys[0]!,
      limits: [usdcLimit("100000000"), ...(published ? [ousdLimit] : [])],
      ...(pending ? { keyAuthorization: pending, permissionSemantics: 1 } : {}),
    };
    const otherKey = {
      ...walletState().accessKeys[0]!,
      address: testAccessKey2,
      access: testWallet2,
      privateKey: testPrivateKey2,
    };
    await writeWalletState(
      walletState({
        accounts: [{ address: testWallet }, { address: testWallet2 }],
        accessKeys: [key, otherKey],
      }),
    );

    await updateAccessKeyHandler(await readyWallet(), { limit: "250" }, () =>
      walletProvider(replacement, saved),
    );

    // Read the store as the command left it, without draining the SDK's write queue first.
    const state = await loadWalletState();
    expect(state.accounts).toEqual([{ address: testWallet }, { address: testWallet2 }]);
    expect(state.accessKeys).toEqual([
      { ...key, limits, ...(replacement ? { keyAuthorization: replacement } : {}) },
      otherKey,
    ]);
  },
);
