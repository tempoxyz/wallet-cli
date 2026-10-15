import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach } from "vitest";

import "./fixtures/no-network.mjs";

// Tests must stay offline. The guard refuses connections to non-loopback hosts in this worker and in
// the CLI subprocesses it spawns, which inherit this log path; a refusal recorded there fails the
// test, even when the code under test swallows the error.
const log = join(tmpdir(), `wallet-cli-refused-${process.pid}.log`);
process.env.TEMPO_TEST_REFUSED_LOG = log;
writeFileSync(log, "");
afterAll(() => rmSync(log, { force: true }));

/** Fails with every `host:port` the guard refused since the last check, then clears the log. */
export function expectOffline() {
  const hosts = new Set(readFileSync(log, "utf8").split("\n").filter(Boolean));
  writeFileSync(log, "");
  if (hosts.size > 0)
    throw new Error(`Test opened outbound connections to ${[...hosts].join(", ")}`);
}

afterEach(expectOffline);
