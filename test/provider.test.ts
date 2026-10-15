import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => {
  const authUrl = process.env.TEMPO_AUTH_URL;
  process.env.TEMPO_AUTH_URL = "https://wallet-jxom-update-access-key-l.tempo.local";
  return { authUrl };
});

const mocks = vi.hoisted(() => ({
  cli: vi.fn(
    (_options: {
      host: string;
      open: (url: string, prompt: { userCode: string }) => Promise<void> | void;
    }) => Object.assign(() => ({ actions: {} }), { rdns: "xyz.tempo.cli" }),
  ),
  create: vi.fn((_options: Record<string, unknown>) => ({
    request: vi.fn(),
    store: { persist: { hasHydrated: () => true } },
  })),
  filesystem: vi.fn(() => ({ key: "storage" })),
}));

vi.mock("accounts/cli", () => ({
  cli: mocks.cli,
  Storage: { filesystem: mocks.filesystem },
}));

vi.mock("accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("accounts")>()),
  Provider: { create: mocks.create },
}));

import { createProvider } from "../src/provider.js";

afterAll(() => {
  if (environment.authUrl === undefined) delete process.env.TEMPO_AUTH_URL;
  else process.env.TEMPO_AUTH_URL = environment.authUrl;
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.cli.mockClear();
  mocks.create.mockClear();
  mocks.filesystem.mockClear();
});

describe("provider", () => {
  it("targets the configured wallet device auth endpoint", async () => {
    await createProvider({ network: { name: "testnet", chainId: 42431 }, noBrowser: true });

    expect(mocks.cli).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "https://wallet-jxom-update-access-key-l.tempo.local/api/auth/device",
      }),
    );
    expect(mocks.create).toHaveBeenCalledWith({
      adapter: expect.objectContaining({ rdns: "xyz.tempo.cli" }),
      mpp: { mode: "pull" },
      storage: { key: "storage" },
      testnet: true,
    });
  });

  it("prints the device confirmation code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await createProvider({ network: { name: "mainnet", chainId: 4217 }, noBrowser: true });
    const options = mocks.cli.mock.calls[0]![0];

    await options.open("https://wallet.tempo.xyz/api/auth/device/verify?user_code=ABCDEFGH", {
      userCode: "ABCDEFGH",
    });

    expect(error.mock.calls).toEqual([
      ["Device confirmation code: ABCD-EFGH"],
      ["Continue at: https://wallet.tempo.xyz/api/auth/device/verify?user_code=ABCDEFGH"],
    ]);
  });
});
