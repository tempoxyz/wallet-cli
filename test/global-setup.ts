import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import type { TestProject } from "vitest/node";

const root = resolve(import.meta.dirname, "..");

declare module "vitest" {
  export interface ProvidedContext {
    cliBundles: { request: string; wallet: string };
  }
}

// Subprocess tests run the CLIs from one prebuilt bundle instead of transpiling the
// sources with tsx on every spawn. Options mirror the release bundle in scripts/package.ts.
export default async function setup(project: TestProject) {
  // incur keeps skill sync state under XDG_DATA_HOME; an empty directory keeps the developer's
  // installed skills from adding a "Skills are out of date" notice to test output.
  const dataHome = await mkdtemp(join(tmpdir(), "wallet-cli-data-"));
  process.env.XDG_DATA_HOME = dataHome;
  // Device-code and fund tests must never open the developer's browser, in workers or in the
  // CLI subprocesses they spawn.
  process.env.TEMPO_NO_BROWSER = "1";
  // Tests and the CLI subprocesses they spawn inherit these, so an RPC or wallet app call a test
  // does not serve itself hits a dead loopback port instead of the public network.
  process.env.TEMPO_RPC_URL = "http://127.0.0.1:9";
  process.env.TEMPO_AUTH_URL = "http://127.0.0.1:9";
  // Every Node process started from here on, vitest workers and the CLI subprocesses tests spawn,
  // preloads the guard that refuses connections to non-loopback hosts.
  const guard = pathToFileURL(join(root, "test/fixtures/loopback-only.mjs")).href;
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import=${guard}`]
    .filter(Boolean)
    .join(" ");
  const outdir = await mkdtemp(join(tmpdir(), "wallet-cli-bundle-"));
  const { version, dependencies } = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as { version: string; dependencies: Record<string, string> };
  await build({
    entryPoints: {
      "tempo-request": join(root, "src/request-cli.ts"),
      "tempo-wallet": join(root, "src/cli.ts"),
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outdir,
    outExtension: { ".js": ".cjs" },
    define: {
      "process.env.TEMPO_WALLET_VERSION": JSON.stringify(version),
      "process.env.TEMPO_WALLET_INCUR_VERSION": JSON.stringify(dependencies.incur),
      "process.env.TEMPO_WALLET_ACCOUNTS_VERSION": JSON.stringify(dependencies.accounts),
    },
    logLevel: "error",
  });
  project.provide("cliBundles", {
    request: join(outdir, "tempo-request.cjs"),
    wallet: join(outdir, "tempo-wallet.cjs"),
  });
  return async () => {
    await rm(outdir, { force: true, recursive: true });
    await rm(dataHome, { force: true, recursive: true });
  };
}
