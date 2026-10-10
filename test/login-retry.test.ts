import type { Adapter } from "accounts";
import { Storage } from "accounts/cli";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAccounts: vi.fn<Adapter.Instance["actions"]["loadAccounts"]>(),
}));

vi.mock("../src/provider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/provider.js")>();
  const { Adapter, Provider } = await import("accounts");
  const { Storage } = await import("accounts/cli");
  const adapter = Adapter.define({ name: "Test authorization" }, () => ({
    actions: {
      createAccount: async () => {
        throw new Error("Unexpected account creation");
      },
      loadAccounts: mocks.loadAccounts,
    },
  }));
  return {
    ...actual,
    createProvider: (options: { network?: string }) =>
      Provider.create({
        adapter,
        storage: Storage.filesystem(),
        testnet: options.network === "testnet",
        mpp: { mode: "pull" },
      }),
  };
});

vi.mock("../src/shared/network.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/network.js")>()),
  createTempoPublicClient: vi.fn(() => ({ readContract: vi.fn(async () => 0n) })),
}));

import { loginHandler } from "../src/commands/identity.js";
import { parseRequestArgs, resolvePaymentIdentity } from "../src/commands/request.js";
import { handleCompatCommand } from "../src/compat.js";
import { emptyWalletState, loadWalletState, saveWalletState } from "../src/wallet/store.js";
import { useTempHome, walletState } from "./helpers.js";

afterEach(() => {
  mocks.loadAccounts.mockReset();
  vi.unstubAllGlobals();
});

it("request-triggered authorization selects Moderato despite the persisted mainnet default", async () => {
  await useTempHome();
  await saveWalletState(emptyWalletState());
  vi.stubEnv("TEMPO_PRIVATE_KEY", "");
  mocks.loadAccounts.mockRejectedValue(new Error("Stop at device authorization"));
  try {
    await expect(
      resolvePaymentIdentity(parseRequestArgs(["-n", "testnet", "https://example.com"])),
    ).rejects.toThrow("Stop at device authorization");
    await Storage.filesystem().getItem("store");
    expect((await loadWalletState()).chainId).toBe(42431);
    expect(mocks.loadAccounts).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([
  { failure: "User denied the device-code request.", browser: true },
  { failure: "Device code expired before authorization completed.", browser: true },
  { failure: "User denied the device-code request.", browser: false },
  { failure: "Device code expired before authorization completed.", browser: false },
])("login can retry $failure with browser=$browser", async ({ failure, browser }) => {
  await useTempHome();
  await saveWalletState(walletState());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]", { status: 200 })),
  );
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  mocks.loadAccounts.mockRejectedValue(new Error(failure));

  const login = async () => {
    if (!browser) {
      const handled = await handleCompatCommand(["login", "--network", "testnet", "--no-browser"]);
      expect(handled).toBe(false);
    }
    return await loginHandler({ network: "testnet", browser });
  };

  await expect(login()).rejects.toThrow(failure);
  // Drain the SDK's filesystem write queue before reading its persisted selection.
  await Storage.filesystem().getItem("store");
  const state = await loadWalletState();
  expect(state.chainId).toBe(42431);
  expect(state.accessKeys.map((key) => key.chainId)).toEqual([4217]);

  await expect(login()).rejects.toThrow(failure);
  expect(mocks.loadAccounts).toHaveBeenCalledTimes(2);
  await Storage.filesystem().getItem("store");
});
