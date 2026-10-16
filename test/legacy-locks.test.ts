import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { removeUnheldLegacyLocks } from "../src/payment/legacy-locks.js";
import { withSessionLock } from "../src/payment/session-lock.js";
import { useTempHome } from "./helpers.js";

function walletDir() {
  return join(homedir(), ".tempo", "wallet");
}

async function seed(names: readonly string[]) {
  await mkdir(walletDir(), { recursive: true });
  for (const name of names) await writeFile(join(walletDir(), name), "");
}

/** Holds `path`'s flock in another process, as a running Rust CLI did, until released. */
async function holdFlock(path: string) {
  const child = spawn(
    "perl",
    [
      "-e",
      'use Fcntl ":flock"; open(my $f, "<", $ARGV[0]) or die; flock($f, LOCK_EX) or die; $| = 1; print "locked\\n"; <STDIN>;',
      path,
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  const closed = once(child, "close");
  child.stdout.setEncoding("utf8");
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: string) => {
      if (chunk.includes("locked")) resolve();
    });
    void closed.then(() => reject(new Error("perl exited before locking")), reject);
  });
  return async () => {
    child.stdin.end();
    await closed;
  };
}

const legacy = [
  "payment_https___api.example.com.lock",
  "payment_http___127.0.0.1_8787.lock",
  "payment_http___localhost_56261.lock",
  "https___openai.mpp.tempo.xyz.lock",
];

/** Files that are not the Rust CLI's per-origin locks, including other tools' live flock files. */
const unrelated = [
  "channels.db",
  "channels.db.lock",
  `channels.db.${"ab".repeat(32)}.lock`,
  "keys.toml",
  "legacy-sessions.lock",
  "payment_notes.txt",
  "store.json",
];

describe("removeUnheldLegacyLocks", () => {
  it.each([
    { name: "on their own", run: () => removeUnheldLegacyLocks() },
    {
      name: "before a session lock",
      run: () => withSessionLock("https://api.example.com/", async () => "ran"),
    },
  ])("deletes the Rust CLI's unheld lock files and nothing else $name", async ({ run }) => {
    await useTempHome();
    await seed([...legacy, ...unrelated]);

    await run();

    const names = (await readdir(walletDir())).filter((name) => name !== "session-locks");
    expect(names.sort()).toEqual([...unrelated].sort());
  });

  it("keeps a lock file another process holds until it is released", async () => {
    await useTempHome();
    await seed(legacy);
    const held = join(walletDir(), legacy[0]!);
    const release = await holdFlock(held);

    try {
      await removeUnheldLegacyLocks();
      expect(await readdir(walletDir())).toEqual([legacy[0]]);
    } finally {
      await release();
    }

    await removeUnheldLegacyLocks();
    expect(await readdir(walletDir())).toEqual([]);
  });

  it("does nothing without a wallet directory", async () => {
    process.env.HOME = join(await useTempHome(), "missing");

    await expect(removeUnheldLegacyLocks()).resolves.toBeUndefined();
  });
});
