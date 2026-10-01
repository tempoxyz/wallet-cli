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
  it.each([
    ["empty", ""],
    ["unparseable", "not-a-pid\n2026-09-20T00:00:00.000Z\n"],
  ])("releases a stale lock with an %s pid", async (_name, contents) => {
    await useTempHome();
    await seedLock(contents, 60_000);

    await expect(withSessionLock(url, async () => "ran")).resolves.toBe("ran");
  });

  it("leaves a just-created empty lock alone while its holder is still writing", async () => {
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
});
