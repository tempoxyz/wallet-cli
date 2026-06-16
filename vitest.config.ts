import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts"],
    pool: "forks",
    testTimeout: 10_000,
  },
});
