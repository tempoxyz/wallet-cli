// Prints `ready`, then once stdin ends takes the lock at argv[2] and holds it for argv[4]
// milliseconds, appending `enter` and `exit` to the log at argv[3] around the hold and printing
// `held` once inside. Ending the stdin of several at once makes them race for the lock.
import { appendFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { withFileLock } from "../../src/payment/session-lock.js";

const [path = "", log = "", holdMs = "0"] = process.argv.slice(2);

process.stdout.write("ready\n");
for await (const _ of process.stdin);

await withFileLock(path, "test lock", async () => {
  await appendFile(log, "enter\n");
  process.stdout.write("held\n");
  await sleep(Number(holdMs));
  await appendFile(log, "exit\n");
});
