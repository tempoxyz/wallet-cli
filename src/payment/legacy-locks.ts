import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { runProcess } from "../shared/process.js";

/**
 * The per-origin lock files the Rust CLI created in `~/.tempo/wallet/`: `payment_<origin>.lock`,
 * and `<origin>.lock` in older releases, with each character of the origin other than letters,
 * digits, `.`, and `-` replaced by `_`. It held them with flock(2) and never deleted them, so one
 * stayed behind for every origin it paid.
 */
const legacyLockName = /^(payment_)?https?___[A-Za-z0-9._-]+\.lock$/;

// Takes each file's flock without waiting and deletes the file only while holding it, so a file
// another process holds is skipped. Node has no flock(2) binding.
const unlinkUnheld = `use Fcntl ":flock";
for my $path (@ARGV) {
  open(my $fh, "<", $path) or next;
  unlink($path) if flock($fh, LOCK_EX | LOCK_NB);
  close($fh);
}`;

/**
 * Deletes the Rust CLI's per-origin lock files that no process holds. A file is deleted only while
 * this run holds its flock, which perl takes; without perl, as on Windows, the files are kept.
 * Best effort: a failure leaves the files for the next run.
 */
export async function removeUnheldLegacyLocks() {
  const dir = join(homedir(), ".tempo", "wallet");
  const paths = (await readdir(dir).catch(() => []))
    .filter((name) => legacyLockName.test(name))
    .map((name) => join(dir, name));
  if (paths.length === 0) return;
  await runProcess("perl", ["-e", unlinkUnheld, ...paths]).catch(() => undefined);
}
