import { EventEmitter } from "node:events";

/**
 * A child process for a mocked `spawn` that fails to start with the errno `code`, reported after
 * `spawn` returns, as Node does.
 */
export function failedSpawn(code: string) {
  const stream = () =>
    Object.assign(new EventEmitter(), { setEncoding() {}, write() {}, end() {} });
  const child = Object.assign(new EventEmitter(), {
    stdin: stream(),
    stdout: stream(),
    stderr: stream(),
  });
  setImmediate(() =>
    child.emit("error", Object.assign(new Error(`spawn sqlite3 ${code}`), { code })),
  );
  return child;
}
