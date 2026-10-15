import net from "node:net";

import { afterEach } from "vitest";

// Tests must stay offline: sockets only reach loopback servers a test starts itself. Guarding the
// connection rather than `fetch` also covers redirects and the undici fetch `tempo request` uses.
// A connection to any other host is refused and fails the test, even when the code under test
// swallows the error.
const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const connect = net.Socket.prototype.connect;

/** `host:port` targets refused since the last test; a test that expects a refusal drains it. */
export const blockedHosts: string[] = [];

net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  // `net.connect` and `tls.connect` pass their normalized arguments as one array.
  const target = tcpTarget(Array.isArray(args[0]) ? args[0] : args);
  if (target === undefined || loopback.has(target.host)) return connect.apply(this, args as never);
  const host = `${target.host}:${target.port}`;
  blockedHosts.push(host);
  const error = new Error(`Tests must not connect to ${host}; mock it or serve it from loopback`);
  process.nextTick(() => this.destroy(error));
  return this;
} as typeof connect;

afterEach(() => {
  const hosts = blockedHosts.splice(0);
  if (hosts.length > 0) throw new Error(`Test opened outbound connections to ${hosts.join(", ")}`);
});

/** The TCP host and port a `connect` call dials, or undefined for an IPC path, as Node reads them. */
function tcpTarget([first, second]: unknown[]) {
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first)))
    return { host: typeof second === "string" ? second : "localhost", port: first };
  if (typeof first !== "object" || first === null) return undefined;
  const { host, path, port } = first as { host?: string; path?: string; port?: number | string };
  return path ? undefined : { host: host || "localhost", port };
}
