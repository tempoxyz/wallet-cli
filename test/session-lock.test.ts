import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { withFileLock, withSessionLock } from "../src/payment/session-lock.js";
import { walletError } from "../src/shared/errors.js";
import { querySql, runSql, runSqlScript } from "../src/shared/process.js";
import { nowSeconds } from "../src/shared/utils.js";
import { createIdempotencyRecord, pruneIdempotencyRecords } from "../src/wallet/idempotency.js";
import { failedSpawn } from "./fixtures/failed-spawn.js";
import { useTempHome } from "./helpers.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const holderScript = join(import.meta.dirname, "fixtures", "lock-holder.ts");

/** Takes sqlite3 off PATH for the rest of the test. */
async function withoutSqlite3() {
  vi.stubEnv("PATH", join(import.meta.dirname, "no-such-bin"));
}

/**
 * Gives sqlite3 the init file a user could have at `~/.sqliterc` or
 * `$XDG_CONFIG_HOME/sqlite3/sqliterc`: it turns bail off, changes the output format, and prints
 * the lock's success marker.
 */
async function withHostileSqliterc(home: string) {
  const rc = ".bail off\n.mode list\n.headers on\n.print locked\n";
  await writeFile(join(home, ".sqliterc"), rc);
  await mkdir(join(home, ".config", "sqlite3"), { recursive: true });
  await writeFile(join(home, ".config", "sqlite3", "sqliterc"), rc);
  vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ["with sqlite3", async () => undefined, (path: string) => path],
  ["with a hostile sqliterc", withHostileSqliterc, (path: string) => path],
  ["without sqlite3", withoutSqlite3, (path: string) => `${path}.pid`],
])("withFileLock %s", (_mode, setUp, lockFile) => {
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
    const { home, path } = await lockFiles();
    await setUp(home);
    const fn = vi.fn(async () => {
      throw error;
    });

    await expect(withFileLock(path, "test lock", fn)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
    await expect(withFileLock(path, "test lock", async () => "next")).resolves.toBe("next");
  });

  it("admits 8 concurrent calls one at a time", async () => {
    const { home, path, log } = await lockFiles();
    await setUp(home);

    await Promise.all(
      Array.from({ length: 8 }, () => withFileLock(path, "test lock", () => holdFor(log, 20))),
    );

    expect(await occupancy(log)).toEqual({ entries: 8, maxConcurrent: 1 });
  });

  it("reports a lock held past the deadline as a retryable timeout without running fn", async () => {
    const { home, path } = await lockFiles();
    await setUp(home);
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const holder = withFileLock(path, "test lock", async () => {
      held();
      await released;
    });
    await holding;

    // Each clock read jumps past the 30-second deadline, so the first wait is the last.
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (now += 40_000));
    const fn = vi.fn(async () => "ran");

    await expect(withFileLock(path, "test lock", fn)).rejects.toMatchObject({
      code: "E_POLL_TIMEOUT",
      exitCode: 3,
      retryable: true,
      message: `Timed out waiting for test lock: ${lockFile(path)}`,
    });
    expect(fn).not.toHaveBeenCalled();
    release();
    await expect(holder).resolves.toBeUndefined();
  });
});

describe("withFileLock with sqlite3", () => {
  it.each([
    ["after a holder is killed mid-critical-section", true, false],
    ["with no holder before them", false, false],
    ["after a holder is killed, with a hostile sqliterc", true, true],
  ])(
    "admits 8 racing processes one at a time %s",
    async (_name, killHolder, hostile) => {
      const { home, path, log } = await lockFiles();
      if (hostile) await withHostileSqliterc(home);
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

  it("fails without running fn when the lock file is not a database", async () => {
    const { path } = await lockFiles();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "12345\n");
    const fn = vi.fn(async () => "ran");

    await expect(withFileLock(path, "test lock", fn)).rejects.toThrow(
      /^sqlite3 failed to lock .*file is not a database/,
    );
    expect(fn).not.toHaveBeenCalled();
    await expect(readFile(path, "utf8")).resolves.toBe("12345\n");
  });
});

// Node emits EAGAIN and EACCES, emits EMFILE and ENFILE without setting up stdio, and throws
// ENOMEM and EPERM; see `failedSpawn`.
describe("withFileLock when sqlite3 cannot start", () => {
  it.each([
    { code: "EAGAIN", retryable: true, reason: "spawn sqlite3 EAGAIN" },
    { code: "EMFILE", retryable: true, reason: "spawn sqlite3 EMFILE" },
    { code: "ENFILE", retryable: true, reason: "spawn sqlite3 ENFILE" },
    { code: "ENOMEM", retryable: true, reason: "spawn ENOMEM" },
    { code: "EACCES", retryable: false, reason: "spawn sqlite3 EACCES" },
    { code: "EPERM", retryable: false, reason: "spawn EPERM" },
  ])(
    "fails with E_RUNTIME on $code, retryable $retryable, without running fn",
    async ({ code, retryable, reason }) => {
      const path = join(await useTempHome(), "test.lock");
      vi.mocked(spawn).mockImplementationOnce(() => failedSpawn(code) as never);
      const fn = vi.fn(async () => "ran");

      await expect(withFileLock(path, "test lock", fn)).rejects.toMatchObject({
        code: "E_RUNTIME",
        exitCode: 1,
        retryable,
        message: `Failed to run sqlite3 for the lock at ${path}: ${reason}`,
      });
      expect(fn).not.toHaveBeenCalled();
    },
  );
});

describe("withFileLock without sqlite3", () => {
  it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "removes the pid file when %s ends its holder mid-critical-section",
    async (signal) => {
      const { path, log } = await lockFiles();
      await withoutSqlite3();
      await killHolding(await startHolder(path, log, 60_000), signal);

      await expect(withFileLock(path, "test lock", async () => "next")).resolves.toBe("next");
    },
  );

  it.each([
    ["while it writes the pid file", "create"],
    ["while it deletes the pid file", "release"],
  ] as const)("removes the pid file when SIGINT arrives %s", async (_name, window) => {
    const { path, log } = await lockFiles();
    await withoutSqlite3();
    const holder = await startHolder(path, log, 0, window);
    holder.start();
    await holder.exited;

    expect(holder.output()).toContain("signaled");
    await expect(readFile(`${path}.pid`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(withFileLock(path, "test lock", async () => "next")).resolves.toBe("next");
  });

  it("refuses the pid file of a holder SIGKILL ended, leaving it for the user to remove", async () => {
    const { path, log } = await lockFiles();
    await withoutSqlite3();
    const holder = await startHolder(path, log, 60_000);
    await killHolding(holder, "SIGKILL");
    const pidFile = `${path}.pid`;
    const fn = vi.fn(async () => "ran");

    await expect(withFileLock(path, "test lock", fn)).rejects.toMatchObject({
      code: "E_RUNTIME",
      exitCode: 1,
      retryable: false,
      message: `The test lock ${pidFile} was left by process ${holder.pid}, which has exited. Once no tempo process is running, remove it with 'rm ${pidFile}' and retry.`,
    });
    expect(fn).not.toHaveBeenCalled();
    await expect(readFile(pidFile, "utf8")).resolves.toBe(`${holder.pid}\n`);
  });

  it("serializes idempotency claims and prunes", async () => {
    const home = await useTempHome();
    await withoutSqlite3();
    const claim = {
      key: "k1",
      wallet: "0x0000000000000000000000000000000000000001",
      chain_id: 4217,
      request: { command: "transfer" },
      status: "submitting" as const,
      tx_hash: null,
      created_at: nowSeconds(),
      result: null,
    };

    await expect(createIdempotencyRecord(claim)).resolves.toBe(true);
    await expect(createIdempotencyRecord(claim)).resolves.toBe(false);
    await expect(pruneIdempotencyRecords()).resolves.toBeUndefined();
    expect(await readdir(join(home, ".tempo", "wallet"))).not.toContain("idempotency.lock.pid");
  });
});

describe("withSessionLock", () => {
  it("fails with E_PAYMENT and a doctor cta without sqlite3, without running fn", async () => {
    await useTempHome();
    await withoutSqlite3();
    const fn = vi.fn(async () => "ran");

    await expect(withSessionLock("https://lock.example.com/", fn)).rejects.toMatchObject({
      code: "E_PAYMENT",
      exitCode: 4,
      retryable: false,
      message:
        "sqlite3 was not found on PATH. Payment sessions need it: install sqlite3, then retry.",
      payload: { cta: { commands: [{ command: "tempo wallet doctor" }] } },
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps one lock file per origin, named by its hash", async () => {
    const home = await useTempHome();
    const urls = [
      "https://a.example.com/one",
      "https://a.example.com/two",
      "https://b.example.com/paid",
      "http://127.0.0.1:8080/paid",
    ];

    for (const url of urls) await expect(withSessionLock(url, async () => url)).resolves.toBe(url);

    const names = await readdir(join(home, ".tempo", "wallet", "session-locks"));
    expect(names).toHaveLength(3);
    expect(names.every((name) => /^[0-9a-f]{64}\.lock$/.test(name))).toBe(true);
  });
});

describe("session store runs despite a hostile sqliterc", () => {
  it.each([
    {
      name: "a query still parses its output",
      run: async () => {
        await runSql("CREATE TABLE t (a INTEGER, b TEXT); INSERT INTO t VALUES (1, 'x');");
        return querySql("SELECT a, b FROM t");
      },
      expected: [{ a: 1, b: "x" }],
    },
    {
      name: "a script still stops at its first failing statement",
      run: async () => {
        await runSql("CREATE TABLE t (id INTEGER PRIMARY KEY); CREATE TABLE m (x)");
        await runSql("INSERT INTO t VALUES (1)");
        await expect(
          runSqlScript("BEGIN;\nINSERT INTO t VALUES (1);\nINSERT INTO m VALUES (1);\nCOMMIT;\n"),
        ).rejects.toThrow("UNIQUE constraint failed");
        return querySql("SELECT COUNT(*) AS n FROM m");
      },
      expected: [{ n: 0 }],
    },
  ])("$name", async ({ run, expected }) => {
    await withHostileSqliterc(await useTempHome());

    await expect(run()).resolves.toEqual(expected);
  });
});

async function lockFiles() {
  const home = await useTempHome();
  return { home, path: join(home, "locks", "test.lock"), log: join(home, "critical.log") };
}

/** Logs entering and leaving a critical section that lasts `ms`. */
async function holdFor(log: string, ms: number) {
  await appendFile(log, "enter\n");
  await sleep(ms);
  await appendFile(log, "exit\n");
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

/** Lets `holder` take the lock, then ends it with `signal` while it holds it. */
async function killHolding(holder: Holder, signal: NodeJS.Signals = "SIGKILL") {
  holder.start();
  await holder.printed("held");
  holder.kill(signal);
  await holder.exited;
}

/**
 * Starts test/fixtures/lock-holder.ts for the lock at `path`, resolving once it is ready for
 * `start` to send it after the lock.
 */
async function startHolder(
  path: string,
  log: string,
  holdMs: number,
  signalDuring?: "create" | "release",
) {
  const args = [holderScript, path, log, `${holdMs}`, ...(signalDuring ? [signalDuring] : [])];
  const child = spawn(process.execPath, ["--import", "tsx", ...args], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  // `close` comes after the last of its output.
  const exited = once(child, "close").then(([code]) => code as number | null);
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
    pid: child.pid,
    exited,
    printed,
    output: () => output,
    start: () => child.stdin.end(),
    kill: (signal: NodeJS.Signals) => child.kill(signal),
  };
}
