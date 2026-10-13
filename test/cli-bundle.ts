import { inject } from "vitest";

/** Path to the prebuilt CLI bundle from test/global-setup.ts, for subprocess tests. */
export function cliBundle(name: "request" | "wallet") {
  return inject("cliBundles")[name];
}
