import { EventEmitter } from "node:events";

/**
 * What a mocked `spawn` of `command` does when the process cannot start with the errno `code`, as
 * Node's `spawn` does: it throws most codes, such as ENOMEM, and emits EACCES, EAGAIN, EMFILE,
 * ENFILE, and ENOENT on the next tick, leaving stdio unset for EMFILE and ENFILE.
 */
export function failedSpawn(code: string, command = "sqlite3") {
  if (!["EACCES", "EAGAIN", "EMFILE", "ENFILE", "ENOENT"].includes(code))
    throw Object.assign(new Error(`spawn ${code}`), { code, syscall: "spawn" });
  const stream = () =>
    code === "EMFILE" || code === "ENFILE"
      ? undefined
      : Object.assign(new EventEmitter(), { setEncoding() {}, write() {}, end() {} });
  const child = Object.assign(new EventEmitter(), {
    stdin: stream(),
    stdout: stream(),
    stderr: stream(),
  });
  const error = Object.assign(new Error(`spawn ${command} ${code}`), {
    code,
    syscall: `spawn ${command}`,
  });
  process.nextTick(() => child.emit("error", error));
  return child;
}
