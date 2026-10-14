import { createServer } from "node:http";

import type { Adapter } from "accounts";
import { Storage } from "accounts/cli";
import { Challenge } from "mppx";
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
      actual.providerReady(
        Provider.create({
          adapter,
          storage: Storage.filesystem(),
          testnet: options.network === "testnet",
          mpp: { mode: "pull" },
        }),
      ),
  };
});

vi.mock("../src/shared/network.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/network.js")>()),
  createTempoPublicClient: vi.fn(() => ({ readContract: vi.fn(async () => 0n) })),
}));

import { parseRequestArgs, resolvePaymentIdentity, runRequest } from "../src/commands/request.js";
import { emptyWalletState, loadWalletState, saveWalletState } from "../src/wallet/store.js";
import { useTempHome } from "./helpers.js";

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
  { intent: "charge", offers: ["charge"] },
  { intent: "auto", offers: ["session", "charge"] },
] as const)(
  "request reports a login that yields no account as E_NOT_AUTHENTICATED with --payment-intent $intent",
  async ({ intent, offers }) => {
    await useTempHome();
    await saveWalletState(emptyWalletState());
    vi.stubEnv("TEMPO_PRIVATE_KEY", "");
    mocks.loadAccounts.mockResolvedValue({ accounts: [] });
    const header = offers
      .map((offer) =>
        Challenge.serialize(
          Challenge.from({
            id: `no-account-${offer}`,
            intent: offer,
            method: "tempo",
            realm: "example",
            request: {
              amount: "1",
              currency: "0x20c000000000000000000000b9537d11c60e8b50",
              methodDetails: {
                chainId: 4217,
                ...(offer === "session" ? { sessionProtocol: "v2" } : {}),
              },
              recipient: "0x0000000000000000000000000000000000000001",
            },
          }),
        ),
      )
      .join(", ");
    const server = createServer((_request, response) => {
      response.statusCode = 402;
      response.setHeader("www-authenticate", header);
      response.end("payment required");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected TCP test server address");
    try {
      await expect(
        runRequest(["--payment-intent", intent, `http://127.0.0.1:${address.port}/paid`], {
          stdout: { write: () => true },
        }),
      ).rejects.toMatchObject({ code: "E_NOT_AUTHENTICATED", exitCode: 4 });
      expect(mocks.loadAccounts).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllEnvs();
      // Drain the SDK's filesystem write queue before the temp home is removed.
      await Storage.filesystem().getItem("store");
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
