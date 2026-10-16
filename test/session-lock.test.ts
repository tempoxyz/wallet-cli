import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import { afterEach, describe, expect, it, vi } from "vitest";

import { withFileLock, withSessionLock } from "../src/payment/session-lock.js";
import { walletError } from "../src/shared/errors.js";
import { useTempHome } from "./helpers.js";

const holderScript = join(import.meta.dirname, "fixtures", "lock-holder.ts");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withFileLock", () => {
  it.each([
    [
      "an EEXIST error",
      Object.assign(new Error("EEXIST: file already exists"), { code: "EEXIST" }),
    ],
    [
      "a retryable E_RUNTIME error",
      walletError({ code: "E_RUNTIME", message: "store load timed out", retryable: true }),
    ],
    ["any other error", new Error("boom")],
  ])("propagates %s from fn unchanged without running fn again", async (_name, error) => {
    const { path } = await lockFiles();
    const fn = vi.fn(async () => {
      throw error;
    });

    await expect(withFileLock(path, "test lock", fn)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(withFileLock(path, "test lock", async () => "next")).resolves.toBe("next");
  });

  it.each([
    [
      "sqlite3 is not on PATH",
      async (path: string) => vi.stubEnv("PATH", join(dirname(path), "no-bin")),
      /^Failed to run sqlite3 for the lock at .*ENOENT/,
    ],
    [
      "the lock file is not a database",
      async (path: string) => writeFile(path, "12345\n"),
      /^sqlite3 failed to lock .*file is not a database/,
    ],
  ])("fails without running fn when %s", async (_name, arrange, message) => {
    const { path } = await lockFiles();
    await mkdir(dirname(path), { recursive: true });
    await arrange(path);
    const fn = vi.fn(async () => "ran");

    await expect(withFileLock(path, "test lock", fn)).rejects.toThrow(message);
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ["after a holder is killed mid-critical-section", true],
    ["with no holder before them", false],
  ])(
    "admits 8 racing processes one at a time %s",
    async (_name, killHolder) => {
      const { path, log } = await lockFiles();
      if (killHolder) await killHolding(await startHolder(path, `${log}.killed`, 60_000));

      const racers = await Promise.all(Array.from({ length: 8 }, () => startHolder(path, log, 50)));
      for (const racer of racers) racer.start();

      expect(await Promise.all(racers.map((racer) => racer.exited))).toEqual(Array(8).fill(0));
      expect(await occupancy(log)).toEqual({ entries: 8, maxConcurrent: 1 });
    },
    30_000,
  );

  it("lets the next acquirer in promptly after a holder is killed mid-critical-section", async () => {
    const { path, log } = await lockFiles();
    await killHolding(await startHolder(path, log, 60_000));

    const killedAt = performance.now();
    const waitedMs = await withFileLock(
      path,
      "test lock",
      async () => performance.now() - killedAt,
    );

    expect(waitedMs).toBeLessThan(2_000);
  });
});

describe("withSessionLock", () => {
  const url = "https://lock.example.com/resource";

  it("reports a lock held past the deadline as a retryable timeout without running fn", async () => {
    await useTempHome();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const holder = withSessionLock(url, async () => {
      held();
      await released;
    });
    await holding;

    // Each clock read jumps past the 30-second deadline, so the first wait is the last.
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (now += 40_000));
    const fn = vi.fn(async () => "ran");

    await expect(withSessionLock(url, fn)).rejects.toMatchObject({
      code: "E_POLL_TIMEOUT",
      exitCode: 3,
      retryable: true,
      message: expect.stringMatching(/^Timed out waiting for session lock: \S+\.lock$/),
    });
    expect(fn).not.toHaveBeenCalled();
    release();
    await expect(holder).resolves.toBeUndefined();
  });

  it("keeps lock files to a fixed set of hashed names rather than one per origin", async () => {
    const home = await useTempHome();
    const origins = ["https://a.example.com", "https://b.example.com", "http://127.0.0.1:8080"];

    for (const origin of origins)
      await expect(withSessionLock(`${origin}/paid`, async () => origin)).resolves.toBe(origin);

    const names = await readdir(join(home, ".tempo", "wallet", "session-locks"));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => /^[0-9a-f]{2}\.lock$/.test(name))).toBe(true);
  });
});

async function lockFiles() {
  const home = await useTempHome();
  return { path: join(home, "locks", "test.lock"), log: join(home, "critical.log") };
}

/** How many critical sections `log` records, and the most that overlapped. */
async function occupancy(log: string) {
  let entries = 0;
  let inside = 0;
  let maxConcurrent = 0;
  for (const line of (await readFile(log, "utf8")).split("\n").filter(Boolean)) {
    if (line === "enter") entries++;
    inside += line === "enter" ? 1 : -1;
    maxConcurrent = Math.max(maxConcurrent, inside);
  }
  return { entries, maxConcurrent };
}

type Holder = Awaited<ReturnType<typeof startHolder>>;

/** Lets `holder` take the lock, then kills it with SIGKILL while it holds it. */
async function killHolding(holder: Holder) {
  holder.start();
  await holder.printed("held");
  holder.kill();
  await holder.exited;
}

/**
 * Starts test/fixtures/lock-holder.ts for the lock at `path`, resolving once it is ready for
 * `start` to send it after the lock.
 */
async function startHolder(path: string, log: string, holdMs: number) {
  const child = spawn(process.execPath, ["--import", "tsx", holderScript, path, log, `${holdMs}`], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const exited = once(child, "exit").then(([code]) => code as number | null);
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (output += chunk));
  const printed = (word: string) =>
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (output.split("\n").includes(word)) resolve();
      };
      child.stdout.on("data", check);
      check();
      void exited.then((code) => reject(new Error(`lock holder exited with ${code}`)));
    });
  await printed("ready");
  return {
    exited,
    printed,
    start: () => child.stdin.end(),
    kill: () => child.kill("SIGKILL"),
  };
}
