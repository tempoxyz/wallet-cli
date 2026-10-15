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

import type { Transport } from "viem";

import { createProvider } from "../src/provider.js";

afterAll(() => {
  if (environment.authUrl === undefined) delete process.env.TEMPO_AUTH_URL;
  else process.env.TEMPO_AUTH_URL = environment.authUrl;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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
      storage: expect.objectContaining({ key: "storage" }),
      testnet: true,
      transports: { 4217: expect.any(Function), 42431: expect.any(Function) },
    });
  });

  // The provider fills, signs, and sends its transactions through these, not viem's default RPCs.
  it.each([
    {
      name: "TEMPO_RPC_URL",
      rpc: "http://127.0.0.1:8545",
      urls: { 4217: "http://127.0.0.1:8545", 42431: "http://127.0.0.1:8545" },
    },
    {
      name: "the default RPCs",
      rpc: undefined,
      urls: { 4217: "https://rpc.mainnet.tempo.xyz", 42431: "https://rpc.moderato.tempo.xyz" },
    },
  ])("sends each network's RPC requests to $name", async ({ rpc, urls }) => {
    vi.stubEnv("TEMPO_RPC_URL", rpc);

    await createProvider({ network: { name: "mainnet", chainId: 4217 }, noBrowser: true });

    const { transports } = mocks.create.mock.calls[0]![0] as {
      transports: Record<number, Transport>;
    };
    const target = (transport: Transport) =>
      (transport({}) as { value?: { url?: string } }).value?.url;
    expect({ 4217: target(transports[4217]!), 42431: target(transports[42431]!) }).toEqual(urls);
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
