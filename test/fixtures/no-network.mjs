// Keeps tests offline by refusing TCP connections to any host but loopback. test/setup.ts loads it
// into each vitest worker, and NODE_OPTIONS preloads it into every CLI subprocess the tests spawn.
// Each refused `host:port` is appended to $TEMPO_TEST_REFUSED_LOG so the test that caused it fails.
import { appendFileSync } from "node:fs";
import net from "node:net";

const installed = Symbol.for("wallet-cli.no-network");

if (!globalThis[installed]) {
  globalThis[installed] = true;
  const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  const connect = net.Socket.prototype.connect;

  net.Socket.prototype.connect = function (...args) {
    // `net.connect` and `tls.connect` pass their normalized arguments as one array.
    const target = tcpTarget(Array.isArray(args[0]) ? args[0] : args);
    if (target === undefined || loopback.has(target.host)) return connect.apply(this, args);
    const host = `${target.host}:${target.port}`;
    const log = process.env.TEMPO_TEST_REFUSED_LOG;
    if (log) appendFileSync(log, `${host}\n`);
    const error = new Error(`Tests must not connect to ${host}; mock it or serve it from loopback`);
    process.nextTick(() => this.destroy(error));
    return this;
  };
}

/** The TCP host and port a `connect` call dials, or undefined for an IPC path, as Node reads them. */
function tcpTarget([first, second]) {
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first)))
    return { host: typeof second === "string" ? second : "localhost", port: first };
  if (typeof first !== "object" || first === null) return undefined;
  return first.path ? undefined : { host: first.host || "localhost", port: first.port };
}
