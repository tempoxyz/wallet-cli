import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { TestProject } from "vitest/node";

import { buildCliBundles } from "../build-bundles.js";
import { type Localnet, provision, startNodes } from "./localnet.js";

declare module "vitest" {
  export interface ProvidedContext {
    cliBundles: { request: string; wallet: string };
    localnet: Localnet;
  }
}

const root = resolve(import.meta.dirname, "../..");

export default async function setup(project: TestProject) {
  const dataHome = await mkdtemp(join(tmpdir(), "wallet-cli-e2e-data-"));
  process.env.XDG_DATA_HOME = dataHome;
  process.env.TEMPO_NO_BROWSER = "1";
  // Everything the end-to-end run talks to is on loopback; the guard proves nothing else is reached.
  const guard = pathToFileURL(join(root, "test/fixtures/loopback-only.mjs")).href;
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import=${guard}`]
    .filter(Boolean)
    .join(" ");
  const [bundles, nodes] = await Promise.all([
    buildCliBundles(),
    startNodes(`wallet-cli-e2e-${process.pid}`),
  ]);
  try {
    project.provide("localnet", await provision(nodes));
  } catch (error) {
    await nodes.close();
    throw error;
  }
  project.provide("cliBundles", { request: bundles.request, wallet: bundles.wallet });
  return async () => {
    await nodes.close();
    await rm(bundles.outdir, { force: true, recursive: true });
    await rm(dataHome, { force: true, recursive: true });
  };
}
