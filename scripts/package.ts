import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { arch, platform } from "node:process";
import { spawnSync } from "node:child_process";

type PackageJson = {
  version?: string;
};

type CliPackageName = "tempo-wallet" | "tempo-request";

const args = new Set(process.argv.slice(2));
const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;
const packageName = resolvePackageName();
const version = process.env.TEMPO_WALLET_VERSION ?? packageJson.version ?? "0.0.0-dev";
const outDir = resolve(root, process.env.TEMPO_WALLET_PACKAGE_DIR ?? "dist-package");
const bundlePath = join(outDir, `${packageName}.cjs`);
const suffix = process.env.TEMPO_WALLET_PACKAGE_SUFFIX ?? hostSuffix();
const target = process.env.TEMPO_WALLET_PKG_TARGET ?? hostPkgTarget();
const output = resolve(
  root,
  process.env.TEMPO_WALLET_PACKAGE_OUTPUT ?? join(outDir, `${packageName}-${suffix}`),
);
const entrypoint = packageName === "tempo-request" ? "src/request-cli.ts" : "src/cli.ts";

mkdirSync(outDir, { recursive: true });

run("esbuild", [
  entrypoint,
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node22",
  `--define:process.env.TEMPO_WALLET_VERSION=${JSON.stringify(version)}`,
  `--outfile=${bundlePath}`,
]);

if (!args.has("--bundle-only")) {
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });
  run("pkg", [
    bundlePath,
    "--targets",
    target,
    "--output",
    output,
    "--fallback-to-source",
    "--public-packages",
    "*",
  ]);
  console.log(`packaged ${output}`);
}

function run(command: string, commandArgs: readonly string[]) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resolvePackageName(): CliPackageName {
  const value = process.env.TEMPO_WALLET_PACKAGE_NAME ?? process.env.PACKAGE ?? "tempo-wallet";

  if (value === "tempo-wallet" || value === "tempo-request") return value;

  throw new Error(`unsupported TypeScript CLI package: ${value}`);
}

function hostSuffix() {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : platform;
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : arch;
  return `${os}-${cpu}`;
}

function hostPkgTarget() {
  const os = platform === "darwin" ? "macos" : platform;
  const cpu = arch === "x64" ? "x64" : arch;
  return `node22-${os}-${cpu}`;
}
