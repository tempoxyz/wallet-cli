import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

/**
 * Bundles both CLIs into a temporary directory, with the options of the release bundle in
 * scripts/package.ts, so subprocess tests run one prebuilt bundle instead of transpiling the
 * sources with tsx on every spawn.
 */
export async function buildCliBundles() {
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
  return {
    outdir,
    request: join(outdir, "tempo-request.cjs"),
    wallet: join(outdir, "tempo-wallet.cjs"),
  };
}
