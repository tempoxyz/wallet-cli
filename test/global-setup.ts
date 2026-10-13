import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  const outdir = await mkdtemp(join(tmpdir(), "wallet-cli-bundle-"));
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    version: string;
  };
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
    define: { "process.env.TEMPO_WALLET_VERSION": JSON.stringify(version) },
    logLevel: "error",
  });
  project.provide("cliBundles", {
    request: join(outdir, "tempo-request.cjs"),
    wallet: join(outdir, "tempo-wallet.cjs"),
  });
  return () => rm(outdir, { force: true, recursive: true });
}
