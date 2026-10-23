import { defineConfig } from "vitest/config";

// `pnpm test:e2e`: the CLI bundles against local Docker chains, a stand-in relay, and local paid
// servers. Opt-in, since it needs Docker; `pnpm test` never runs it.
export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["test/e2e/global-setup.ts"],
    globals: false,
    include: ["test/e2e/**/*.e2e.ts"],
    pool: "forks",
    // Every file shares the chains, so they run one at a time.
    fileParallelism: false,
    setupFiles: ["test/e2e/setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
