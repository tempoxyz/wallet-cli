import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { withSessionLock } from "../src/payment/session-lock.js";
import { useTempHome } from "./helpers.js";

const url = "https://lock.example.com/resource";

function lockPath() {
  const key = new URL(url).origin.replace(/[^A-Za-z0-9.-]/g, "_");
  return join(homedir(), ".tempo", "wallet", "session-locks", `${key}.lock`);
}

async function seedLock(contents: string, ageMs = 0) {
  const path = lockPath();
  await mkdir(join(homedir(), ".tempo", "wallet", "session-locks"), { recursive: true });
  await writeFile(path, contents);
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    await utimes(path, when, when);
  }
  return path;
}

describe("withSessionLock", () => {
  it("releases a lock left empty by a holder that died before writing its pid", async () => {
    // open(path, "wx") creates the lock and writeFile records the pid as a
    // separate step; a holder that dies in between leaves an empty lock with
    // no pid to check, which used to make every later run wait out the
    // 30s deadline and fail.
    await useTempHome();
    await seedLock("", 60_000);

    await expect(withSessionLock(url, async () => "ran")).resolves.toBe("ran");
  });

  it("releases a lock whose pid line is not a usable pid", async () => {
    await useTempHome();
    await seedLock("not-a-pid\n2026-09-20T00:00:00.000Z\n", 60_000);

    await expect(withSessionLock(url, async () => "ran")).resolves.toBe("ran");
  });

  it("leaves a just-created empty lock alone while its holder is still writing", async () => {
    // The same empty lock is legitimate for a moment, so it must not be
    // stolen on sight: that would let two holders run at once.
    await useTempHome();
    const path = await seedLock("");

    let settled = false;
    const pending = withSessionLock(url, async () => "ran").finally(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled).toBe(false);
    await expect(stat(path)).resolves.toBeDefined();

    await rm(path, { force: true });
    await expect(pending).resolves.toBe("ran");
  });

  it("releases a lock held by a process that is gone", async () => {
    await useTempHome();
    await seedLock("999999999\n2026-09-20T00:00:00.000Z\n", 60_000);

    await expect(withSessionLock(url, async () => "ran")).resolves.toBe("ran");
  });

  it("respects a lock held by a live process", async () => {
    await useTempHome();
    const path = await seedLock(`${process.pid}\n${new Date().toISOString()}\n`, 60_000);

    let settled = false;
    const pending = withSessionLock(url, async () => "ran").finally(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled).toBe(false);
    await expect(readFile(path, "utf8")).resolves.toContain(`${process.pid}`);

    await rm(path, { force: true });
    await expect(pending).resolves.toBe("ran");
  });

  it("removes the lock after the callback finishes", async () => {
    await useTempHome();
    const path = lockPath();

    await expect(withSessionLock(url, async () => "ran")).resolves.toBe("ran");
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
