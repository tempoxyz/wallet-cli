import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { TestProject } from "vitest/node";

import { buildCliBundles } from "./build-bundles.js";

const root = resolve(import.meta.dirname, "..");

declare module "vitest" {
  export interface ProvidedContext {
    cliBundles: { request: string; wallet: string };
  }
}

// Subprocess tests run the CLIs from one prebuilt bundle; see buildCliBundles.
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
  const { outdir, request, wallet } = await buildCliBundles();
  project.provide("cliBundles", { request, wallet });
  return async () => {
    await rm(outdir, { force: true, recursive: true });
    await rm(dataHome, { force: true, recursive: true });
  };
}
