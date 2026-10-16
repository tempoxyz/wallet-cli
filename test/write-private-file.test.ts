import { stat } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { writePrivateFile } from "../src/wallet/store.js";
import { useTempHome } from "./helpers.js";

const { deleteAfterRename } = vi.hoisted(() => ({
  deleteAfterRename: { path: undefined as string | undefined },
}));

// Another process deleting the file as soon as it is renamed into place, as a login clearing its
// pending login does while another saves one.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      await actual.rename(from, to);
      if (to === deleteAfterRename.path) await actual.unlink(to);
    },
  };
});

it("succeeds when another process deletes the file right after it is renamed into place", async () => {
  const home = await useTempHome();
  const path = join(home, "pending.json");
  deleteAfterRename.path = path;

  await expect(writePrivateFile(path, "{}")).resolves.toBeUndefined();
});

it.skipIf(process.platform === "win32")("writes a file only its owner can read", async () => {
  const home = await useTempHome();
  const path = join(home, "pending.json");
  deleteAfterRename.path = undefined;

  await writePrivateFile(path, "{}");

  expect((await stat(path)).mode & 0o777).toBe(0o600);
});
