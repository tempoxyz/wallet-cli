import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(() => ({ request: vi.fn() })),
  filesystem: vi.fn(() => ({ key: "storage" })),
}));

vi.mock("accounts/cli", () => ({
  Provider: { create: mocks.create },
  Storage: { filesystem: mocks.filesystem },
}));

import { createProvider } from "../src/provider.js";

const originalAuthUrl = process.env.TEMPO_AUTH_URL;

afterEach(() => {
  vi.restoreAllMocks();
  mocks.create.mockClear();
  mocks.filesystem.mockClear();
  if (originalAuthUrl === undefined) delete process.env.TEMPO_AUTH_URL;
  else process.env.TEMPO_AUTH_URL = originalAuthUrl;
});

describe("provider", () => {
  it("targets the configured wallet CLI auth endpoint", () => {
    process.env.TEMPO_AUTH_URL = "https://wallet-jxom-update-access-key-l.tempo.local";

    createProvider({ network: "testnet", noBrowser: true });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "https://wallet-jxom-update-access-key-l.tempo.local/api/auth/cli",
        testnet: true,
      }),
    );
  });
});
