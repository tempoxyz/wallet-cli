import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    // Exercise the real SDK while intercepting its viem signing/RPC boundaries.
    server: { deps: { inline: ["mppx"] } },
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts"],
    pool: "forks",
    testTimeout: 10_000,
  },
});
