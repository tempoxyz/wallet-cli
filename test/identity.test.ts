import { afterEach, describe, expect, it, vi } from "vitest";

import { keysHandler, logoutHandler, whoamiHandler } from "../src/commands/identity.js";
import { accessKeyAuthorizationSeconds, connect } from "../src/provider.js";
import { emptyWalletState, loadWalletState, saveWalletState } from "../src/wallet/store.js";

import {
  expectUsageError,
  readWalletStoreJson,
  testAccessKey,
  testWallet,
  useTempHome,
  walletState,
  writeWalletState,
} from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("wallet store", () => {
  it("loads an empty store when none exists", async () => {
    await useTempHome();
    const state = await loadWalletState();
    expect(state).toEqual(emptyWalletState());
  });

  it("round trips save then load", async () => {
    await useTempHome();
    const state = walletState();
    await saveWalletState(state);
    const loaded = await loadWalletState();
    expect(loaded).toEqual(state);
  });
});

describe("identity commands", () => {
  it("whoami reports ready with a wallet", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await whoamiHandler({});
    expect(result).toMatchObject({
      ready: true,
      wallet: testWallet.toLowerCase(),
    });
  });

  it("whoami --network testnet returns ready false for a mainnet store", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await whoamiHandler({ network: "testnet" });
    expect(result).toEqual({ ready: false });
  });

  it("whoami --credits without a wallet throws E_USAGE", async () => {
    await useTempHome();

    try {
      await whoamiHandler({ credits: true });
      expect.unreachable("expected whoami --credits to throw");
    } catch (error) {
      expectUsageError(
        error,
        "Configuration missing: No wallet configured. Run 'tempo wallet login'.",
      );
    }
  });

  it("keys outputs the basic shape", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await keysHandler();
    expect(result.total).toBe(1);
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0]).toMatchObject({
      address: testAccessKey.toLowerCase(),
      chain_id: 4217,
      wallet_address: testWallet.toLowerCase(),
    });
  });

  it("logout clears the store", async () => {
    await useTempHome();
    await writeWalletState(walletState());

    const result = await logoutHandler();
    expect(result).toMatchObject({
      logged_in: true,
      disconnected: true,
      wallet: testWallet.toLowerCase(),
    });

    expect(await loadWalletState()).toMatchObject({ accounts: [], accessKeys: [] });
    expect(await readWalletStoreJson()).toMatchObject({
      "tempo-cli.store": { state: { accounts: [], accessKeys: [] } },
    });
  });

  it("requests 30-day access keys when connecting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T00:00:00Z"));
    const request = vi.fn().mockResolvedValue({ accounts: [] });

    await connect({ request } as never);

    expect(request).toHaveBeenCalledWith({
      method: "wallet_connect",
      params: [
        {
          capabilities: {
            authorizeAccessKey: {
              expiry: Math.floor(Date.now() / 1000) + accessKeyAuthorizationSeconds,
            },
          },
        },
      ],
    });
  });
});
