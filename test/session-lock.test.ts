import { mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { withSessionLock } from "../src/payment/session-lock.js";
import { useTempHome } from "./helpers.js";

const url = "https://lock.example.com/resource";
const otherUrl = "https://other.example.com/resource";
/** A pid no process has: above every platform's pid limit. */
const exitedPid = 99_999_999;
const exitedLock = `${exitedPid}\n2026-01-01T00:00:00.000Z\n`;

function locksDir() {
  return join(homedir(), ".tempo", "wallet", "session-locks");
}

function lockPath(target = url) {
  const key = new URL(target).origin.replace(/[^A-Za-z0-9.-]/g, "_");
  return join(locksDir(), `${key}.lock`);
}

async function seedLock(contents: string, ageMs = 0, path = lockPath()) {
  await mkdir(locksDir(), { recursive: true });
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

  it("reports a lock held past the deadline as a retryable timeout", async () => {
    await useTempHome();
    const path = await seedLock(`${process.pid}\n${new Date().toISOString()}\n`);
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 20_000));

    await expect(withSessionLock(url, async () => "ran")).rejects.toMatchObject({
      code: "E_POLL_TIMEOUT",
      exitCode: 3,
      retryable: true,
      message: `Timed out waiting for session lock: ${path}`,
    });
  });
});

describe("session lock files", () => {
  it.each([
    { name: "fn resolves", fn: async () => "ran", outcome: { status: "fulfilled", value: "ran" } },
    {
      name: "fn rejects",
      fn: async () => {
        throw new Error("failed");
      },
      outcome: { status: "rejected", reason: new Error("failed") },
    },
  ])("exists only while held, and is removed once $name", async ({ fn, outcome }) => {
    await useTempHome();
    let held: string | undefined;

    const result = await Promise.allSettled([
      withSessionLock(url, async () => {
        held = await readFile(lockPath(), "utf8");
        return fn();
      }),
    ]);

    expect(result).toEqual([outcome]);
    expect(held?.split("\n")[0]).toBe(`${process.pid}`);
    await expect(readdir(locksDir())).resolves.toEqual([]);
  });

  it("runs fn once when it fails with EEXIST", async () => {
    await useTempHome();
    const error = Object.assign(new Error("exists"), { code: "EEXIST" });
    const fn = vi.fn(async () => {
      throw error;
    });

    await expect(withSessionLock(url, fn)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "a lock whose holder exited", contents: exitedLock, ageMs: 0, kept: false },
    { name: "a lock left without a pid", contents: "", ageMs: 60_000, kept: false },
    {
      name: "a cleanup turn its process abandoned",
      file: "https___other.example.com.lock.reclaim",
      contents: "",
      ageMs: 60_000,
      kept: false,
    },
    {
      name: "a cleanup turn in progress",
      file: "https___other.example.com.lock.reclaim",
      contents: "",
      ageMs: 0,
      kept: true,
    },
    {
      name: "a lock a live process holds",
      contents: `${process.pid}\n2026-01-01T00:00:00.000Z\n`,
      ageMs: 60_000,
      kept: true,
    },
    { name: "a lock its holder is still writing", contents: "", ageMs: 0, kept: true },
  ])(
    "taking a session lock cleans up $name for another origin (kept: $kept)",
    async ({ file, contents, ageMs, kept }) => {
      await useTempHome();
      const seeded = file ? join(locksDir(), file) : lockPath(otherUrl);
      await seedLock(contents, ageMs, seeded);

      await expect(withSessionLock(url, async () => "ran")).resolves.toBe("ran");

      await expect(readdir(locksDir())).resolves.toEqual(kept ? [basename(seeded)] : []);
      if (kept) await expect(readFile(seeded, "utf8")).resolves.toBe(contents);
    },
  );

  it.each([
    { name: "a free lock", seed: undefined },
    { name: "a lock whose holder exited", seed: exitedLock },
    { name: "a lock left without a pid", seed: "" },
  ])("serializes concurrent acquires of $name", async ({ seed }) => {
    await useTempHome();
    if (seed !== undefined) await seedLock(seed, 60_000);
    let active = 0;
    let peak = 0;

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        withSessionLock(url, async () => {
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
          return index;
        }),
      ),
    );

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(1);
    await expect(readdir(locksDir())).resolves.toEqual([]);
  });
});
