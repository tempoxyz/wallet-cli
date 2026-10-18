import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

/** The installed package `name` as `dependent` resolves it: pnpm links it beside the dependent. */
function installed(name: string, dependent?: string) {
  const base = dependent
    ? join(realpathSync(join(root, "node_modules", dependent)), "..")
    : join(root, "node_modules");
  return realpathSync(join(base, name));
}

describe("vendored packages", () => {
  it.each(["mppx", "machine-fetch"])("records the commit %s was built from", (name) => {
    expect(readFileSync(join(root, "vendor", name, "VENDORED"), "utf8")).toMatch(
      /^[0-9a-f]{40}\n$/,
    );
  });

  it("installs exactly one mppx, the vendored one, for every dependent", () => {
    const mppx = installed("mppx");
    expect(JSON.parse(readFileSync(join(mppx, "package.json"), "utf8")).name).toBe("mppx");
    expect(mppx).toContain("mppx@file+vendor+mppx");
    for (const dependent of ["machine-fetch", "accounts"])
      expect(installed("mppx", dependent)).toBe(mppx);
    const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
    expect([...new Set(lock.match(/^ {2}mppx@[^(:\n]+(?::[^(:\n]+)?/gm))]).toEqual([
      "  mppx@file:vendor/mppx",
    ]);
  });

  it("bundles one copy of mppx", async () => {
    const { metafile } = await build({
      entryPoints: [join(root, "src/request-cli.ts"), join(root, "src/cli.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      outdir: join(root, "dist-test-bundle"),
      metafile: true,
      logLevel: "silent",
    });
    const roots = new Set(
      Object.keys(metafile.inputs)
        .map((input) => /^(.*node_modules\/mppx)\//.exec(input)?.[1])
        .filter((input) => input !== undefined)
        .map((input) => realpathSync(resolve(root, input))),
    );
    expect([...roots]).toEqual([dirname(join(installed("mppx"), "package.json"))]);
  }, 60_000);
});
