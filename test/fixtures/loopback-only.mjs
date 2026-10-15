// Keeps a CLI subprocess offline like the test workers (see test/setup.ts): a socket to any host
// but loopback is refused and reported on stderr, so the test can fail on it even when the CLI
// swallows the error.
import net from "node:net";

const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const connect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function (...args) {
  // `net.connect` and `tls.connect` pass their normalized arguments as one array.
  const target = tcpTarget(Array.isArray(args[0]) ? args[0] : args);
  if (target === undefined || loopback.has(target.host)) return connect.apply(this, args);
  const message = `blocked outbound connection to ${target.host}:${target.port}`;
  process.stderr.write(`${message}\n`);
  process.nextTick(() => this.destroy(new Error(message)));
  return this;
};

/** The TCP host and port a `connect` call dials, or undefined for an IPC path, as Node reads them. */
function tcpTarget([first, second]) {
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first)))
    return { host: typeof second === "string" ? second : "localhost", port: first };
  if (typeof first !== "object" || first === null) return undefined;
  const { host, path, port } = first;
  return path ? undefined : { host: host || "localhost", port };
}
