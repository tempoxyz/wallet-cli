import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => {
  const authUrl = process.env.TEMPO_AUTH_URL;
  process.env.TEMPO_AUTH_URL = "https://wallet-jxom-update-access-key-l.tempo.local";
  return { authUrl };
});

const mocks = vi.hoisted(() => ({
  create: vi.fn(
    (_options: { open: (url: string, prompt: { userCode: string }) => Promise<void> | void }) => ({
      request: vi.fn(),
    }),
  ),
  filesystem: vi.fn(() => ({ key: "storage" })),
}));

vi.mock("accounts/cli", () => ({
  Provider: { create: mocks.create },
  Storage: { filesystem: mocks.filesystem },
}));

import { createProvider } from "../src/provider.js";

afterAll(() => {
  if (environment.authUrl === undefined) delete process.env.TEMPO_AUTH_URL;
  else process.env.TEMPO_AUTH_URL = environment.authUrl;
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.create.mockClear();
  mocks.filesystem.mockClear();
});

describe("provider", () => {
  it("targets the configured wallet device auth endpoint", () => {
    createProvider({ network: "testnet", noBrowser: true });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "https://wallet-jxom-update-access-key-l.tempo.local/api/auth/device",
        testnet: true,
      }),
    );
  });

  it("prints the device confirmation code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    createProvider({ noBrowser: true });
    const options = mocks.create.mock.calls[0]![0];

    await options.open("https://wallet.tempo.xyz/api/auth/device/verify?user_code=ABCDEFGH", {
      userCode: "ABCDEFGH",
    });

    expect(error.mock.calls).toEqual([
      ["Device confirmation code: ABCD-EFGH"],
      ["Continue at: https://wallet.tempo.xyz/api/auth/device/verify?user_code=ABCDEFGH"],
    ]);
  });
});
