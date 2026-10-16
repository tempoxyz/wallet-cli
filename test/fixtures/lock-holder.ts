// Prints `ready`, then once stdin ends takes the lock at argv[2] and holds it for argv[4]
// milliseconds, appending `enter` and `exit` to the log at argv[3] around the hold and printing
// `held` once inside. Ending the stdin of several at once makes them race for the lock.
//
// With argv[5], it sends itself SIGINT from inside the pid-file lock's own file operation:
// writing its pid (`create`) or deleting the file (`release`).
import fs from "node:fs";
import { appendFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

import { withFileLock } from "../../src/payment/session-lock.js";

const [path = "", log = "", holdMs = "0", signalDuring] = process.argv.slice(2);

if (signalDuring === "create" || signalDuring === "release") {
  const name = signalDuring === "create" ? "writeFileSync" : "rmSync";
  const original = fs[name] as (...args: unknown[]) => unknown;
  // The pid file is written through its descriptor and deleted by its path.
  const targets = (target: unknown) =>
    signalDuring === "create" ? typeof target === "number" : String(target).endsWith(".pid");
  let sent = false;
  Object.assign(fs, {
    [name]: (...args: unknown[]) => {
      if (!sent && targets(args[0])) {
        sent = true;
        fs.writeSync(1, "signaled\n");
        process.kill(process.pid, "SIGINT");
      }
      return original(...args);
    },
  });
  syncBuiltinESMExports();
}

process.stdout.write("ready\n");
for await (const _ of process.stdin);

await withFileLock(path, "test lock", async () => {
  await appendFile(log, "enter\n");
  process.stdout.write("held\n");
  await sleep(Number(holdMs));
  await appendFile(log, "exit\n");
});
