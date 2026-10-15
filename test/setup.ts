import { afterEach } from "vitest";

// Tests must stay offline: `fetch` only reaches loopback servers a test starts itself. A request
// to any other host is refused and fails the test, even when the code under test swallows the error.
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
const realFetch = globalThis.fetch;
const blocked: string[] = [];

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (!loopback.has(url.hostname)) {
    blocked.push(url.href);
    throw new Error(`Tests must not reach ${url.href}; mock it or serve it from a loopback server`);
  }
  return realFetch(input, init);
};

afterEach(() => {
  const urls = blocked.splice(0);
  if (urls.length > 0) throw new Error(`Test made outbound network requests: ${urls.join(", ")}`);
});
