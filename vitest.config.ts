import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    // Exercise the real SDK while intercepting its viem signing/RPC boundaries.
    server: { deps: { inline: ["mppx"] } },
    environment: "node",
    globalSetup: ["test/global-setup.ts"],
    globals: false,
    include: ["test/**/*.test.ts"],
    pool: "forks",
    setupFiles: ["test/setup.ts"],
    testTimeout: 10_000,
  },
});
