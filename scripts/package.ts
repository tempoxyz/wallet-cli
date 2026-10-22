import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { arch, platform } from "node:process";
import { spawnSync } from "node:child_process";

type PackageJson = {
  version?: string;
  dependencies?: Record<string, string>;
};

const entrypoints = {
  "tempo-request": "src/request-cli.ts",
  "tempo-wallet": "src/cli.ts",
};
type CliPackageName = keyof typeof entrypoints;

const args = new Set(process.argv.slice(2));
const root = resolve(import.meta.dirname, "..");
// SEA uses official Node binaries rather than pkg-fetch's patched runtime cache.
const nodeVersion = readFileSync(join(root, ".node-version"), "utf8").trim();
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;
const packageName = resolvePackageName();
const version = process.env.TEMPO_WALLET_VERSION ?? packageJson.version ?? "0.0.0-dev";
const outDir = resolve(root, process.env.TEMPO_WALLET_PACKAGE_DIR ?? "dist-package");
const bundlePath = join(outDir, `${packageName}.cjs`);
const suffix = process.env.TEMPO_WALLET_PACKAGE_SUFFIX ?? hostSuffix();
const target = (process.env.TEMPO_WALLET_PKG_TARGET ?? hostPkgTarget()).replace(
  /^node22-/,
  `node${nodeVersion}-`,
);
if (
  !args.has("--bundle-only") &&
  !["linux-x64", "linux-arm64", "macos-x64", "macos-arm64"].some(
    (platform) => target === `node${nodeVersion}-${platform}`,
  )
) {
  throw new Error(`Packaging requires a node${nodeVersion} target; received ${target}`);
}
const output = resolve(
  root,
  process.env.TEMPO_WALLET_PACKAGE_OUTPUT ?? join(outDir, `${packageName}-${suffix}`),
);
const entrypoint = entrypoints[packageName];

mkdirSync(outDir, { recursive: true });

run("esbuild", [
  entrypoint,
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node22",
  // Every packaged startup (including the release smoke test) verifies the embedded runtime.
  ...(!args.has("--bundle-only")
    ? [
        `--banner:js=if (process.versions.node !== ${JSON.stringify(nodeVersion)}) throw new Error("Unexpected packaged Node.js runtime: " + process.versions.node);`,
      ]
    : []),
  `--define:process.env.TEMPO_WALLET_VERSION=${JSON.stringify(version)}`,
  // `tempo wallet doctor` reports these; the bundle ships without package.json.
  `--define:process.env.TEMPO_WALLET_INCUR_VERSION=${JSON.stringify(packageJson.dependencies?.incur ?? null)}`,
  `--define:process.env.TEMPO_WALLET_ACCOUNTS_VERSION=${JSON.stringify(packageJson.dependencies?.accounts ?? null)}`,
  `--outfile=${bundlePath}`,
]);

if (!args.has("--bundle-only")) {
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });
  run("pkg", [bundlePath, "--sea", "--targets", target, "--output", output]);
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

  if (Object.hasOwn(entrypoints, value)) return value as CliPackageName;

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
  return `node${nodeVersion}-${os}-${cpu}`;
}
